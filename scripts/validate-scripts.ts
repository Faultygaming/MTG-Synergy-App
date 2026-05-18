/**
 * Runtime smoke tests for the maintenance scripts (seed / ingest /
 * preview-map / etc). Catches regressions that lint + typecheck + unit
 * tests can't see — Prisma constraint violations, broken adapter wiring,
 * path resolution errors at script-startup time.
 *
 * Runs each scenario as a real subprocess against a TEMP SQLite database,
 * so this never touches the dev DB. Cleans up after itself.
 *
 * No network — only scripts that can run offline are exercised here.
 * (`ingest` hits Scryfall; covered by its own smoke test on demand, not
 * in the default validate suite.)
 *
 * Usage:
 *   pnpm validate:scripts
 *
 * Wired into `pnpm validate` so every push gets it.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "mtg-validate-scripts-"));
const dbPath = join(tmpDir, "test.db");
const env = { ...process.env, DATABASE_URL: `file:${dbPath}` };
const TSX = "./node_modules/tsx/dist/cli.mjs";

let failures = 0;

function step(label: string, args: string[]): boolean {
  process.stdout.write(`  • ${label}... `);
  const r = spawnSync("node", [TSX, ...args], {
    env,
    cwd: process.cwd(),
    // Capture output so success is quiet; show it on failure.
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.log("✗");
    console.error(r.stdout);
    console.error(r.stderr);
    failures += 1;
    return false;
  }
  console.log("✓");
  return true;
}

function prismaCli(args: string[]): boolean {
  process.stdout.write(`  • prisma ${args.join(" ")}... `);
  const r = spawnSync(
    "node",
    ["./node_modules/prisma/build/index.js", ...args],
    { env, cwd: process.cwd(), encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.log("✗");
    console.error(r.stdout);
    console.error(r.stderr);
    failures += 1;
    return false;
  }
  console.log("✓");
  return true;
}

// Inline tsx -e snippet to inject a "Sol Ring" row with a real-Scryfall-
// looking id. Reproduces the name/id collision that previously crashed seed.
const INJECT_COLLISION = `
import { prisma } from "./src/lib/db";
async function main() {
  await prisma.card.deleteMany({ where: { name: "Sol Ring" } });
  await prisma.card.create({ data: {
    id: "real-id-validate-${Date.now()}",
    name: "Sol Ring",
    typeLine: "Artifact",
    colors: "[]",
    colorIdentity: "[]",
    keywordsJson: "[]",
    oracleTagsJson: "[]",
  } });
}
main().finally(() => prisma.$disconnect());
`;

async function run() {
  console.log(`scripts smoke-tests  (db: ${dbPath})\n`);

  if (!existsSync(TSX)) {
    console.error(
      `✗ tsx CLI not found at ${TSX}. Run \`pnpm install\` first.`,
    );
    process.exit(2);
  }

  console.log("schema setup");
  // Prisma 7 removed --skip-generate; the bare `db push` does the right
  // thing (no-op generate when client is already current).
  prismaCli(["db", "push"]);

  console.log("\nseed-fixtures.ts");
  step("cold seed (empty DB)", ["scripts/seed-fixtures.ts"]);
  step("re-seed (idempotent)", ["scripts/seed-fixtures.ts"]);
  step("inject name/id collision (Sol Ring with real-shape id)", [
    "-e",
    INJECT_COLLISION,
  ]);
  step("seed after collision (must not crash)", [
    "scripts/seed-fixtures.ts",
  ]);

  console.log("\ningest-scryfall.ts (synthetic bulk, no network)");
  // Write a tiny synthetic bulk file: 3 cards, one of which has the
  // SAME NAME as a fixture row that seed just created ("Sol Ring") but
  // a different oracle_id. That's the exact P2002 collision the user
  // hit. The ingest must merge into the existing row, not crash.
  const bulkPath = join(tmpDir, "synth-bulk.json");
  writeFileSync(
    bulkPath,
    JSON.stringify([
      {
        oracle_id: "real-scryfall-id-sol-ring",
        name: "Sol Ring",
        type_line: "Artifact",
        oracle_text: "{T}: Add {C}{C}.",
        cmc: 1,
        colors: [],
        color_identity: [],
        keywords: [],
        scryfall_uri: "https://scryfall.com/card/cmr/309/sol-ring",
        image_uris: {
          small: "https://cards.scryfall.io/small/x.jpg",
          normal: "https://cards.scryfall.io/normal/x.jpg",
        },
      },
      {
        oracle_id: "real-scryfall-id-foo-bar",
        name: "Foo Bar (synthetic)",
        type_line: "Creature — Elf",
        oracle_text: "",
        cmc: 1,
        colors: ["G"],
        color_identity: ["G"],
        keywords: ["Flying"],
      },
      {
        oracle_id: "real-scryfall-id-baz-quux",
        name: "Baz Quux (synthetic)",
        type_line: "Instant",
        oracle_text: "Counter target spell.",
        cmc: 2,
        colors: ["U"],
        color_identity: ["U"],
        keywords: [],
      },
    ]),
  );
  step("ingest against synthetic bulk (must merge by name, not crash)", [
    "scripts/ingest-scryfall.ts",
    "--file",
    bulkPath,
  ]);
  step("ingest again (idempotent, all should be 'refreshed')", [
    "scripts/ingest-scryfall.ts",
    "--file",
    bulkPath,
  ]);

  console.log("\ningest-oracle-tags.ts (offline, file-based)");
  // Empty stub: should print friendly message + exit 0.
  step("apply empty tag-map stub (must not crash)", [
    "scripts/ingest-oracle-tags.ts",
  ]);
  // Populated synthetic map: tag two of the cards we just ingested.
  const tagMapPath = join(tmpDir, "synth-tags.json");
  writeFileSync(
    tagMapPath,
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      tagDigests: { ramp: { count: 1, digest: "abc" }, removal: { count: 1, digest: "def" } },
      cardTags: {
        "real-scryfall-id-foo-bar": ["ramp"],
        "real-scryfall-id-baz-quux": ["removal", "counterspell"],
      },
    }),
  );
  step("apply populated tag-map (must apply to existing cards)", [
    "scripts/ingest-oracle-tags.ts",
    "--file",
    tagMapPath,
  ]);
  // Re-run to check idempotency (no orphaned otag:* from removed tags).
  step("re-apply tag-map (idempotent)", [
    "scripts/ingest-oracle-tags.ts",
    "--file",
    tagMapPath,
  ]);

  console.log("\npreview-map.ts");
  step("build a preview deck from current DB", [
    "scripts/seed-preview-deck.ts",
  ]);
  step("synthetic stress preview (99-card cloud render)", [
    "scripts/preview-map-stress.ts",
  ]);

  console.log();
  if (failures > 0) {
    console.error(`✗ ${failures} step(s) failed`);
    process.exit(1);
  }
  console.log("✓ all scripts smoke tests passed");
}

run()
  .catch((err) => {
    console.error(err);
    failures += 1;
  })
  .finally(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (failures > 0) process.exit(1);
  });
