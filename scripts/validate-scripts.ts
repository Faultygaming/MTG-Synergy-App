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
import { mkdtempSync, rmSync, existsSync } from "node:fs";
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
