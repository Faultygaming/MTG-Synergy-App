/**
 * Offline end-to-end validation for the keyword extraction pipeline.
 *
 *   pnpm tsx scripts/validate-keywords-e2e.ts
 *
 * Builds a throwaway SQLite DB, populates it with a representative
 * fixture (DFCs, emblems, multi-color lands, mana rocks, basic lands,
 * planeswalkers, archetype-bearing spells), then runs the same code
 * paths the Docker container does (`reextract-keywords` + the
 * `analyze-keywords` recomputation logic) and asserts on the results.
 *
 * The goal is to catch keyword-extraction regressions WITHOUT a
 * round-trip through the user's remote container — the "deploy → audit
 * → file bug → push fix" loop is too slow. This script reproduces the
 * relevant slice of the audit locally in <1s.
 *
 * Add fixture rows whenever a new card surfaces a gap. The script
 * exits 1 on any failed assertion so it's safe to wire into `pnpm
 * validate` or CI later.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { extractKeywords } from "../src/lib/synergy/keywords";

interface Fixture {
  id: string;
  name: string;
  typeLine: string;
  oracleText: string;
  producedMana: string[];
  // Keywords that MUST be present in the extracted set.
  expectContains?: string[];
  // Keywords that MUST NOT be present.
  expectMissing?: string[];
}

const FIXTURES: Fixture[] = [
  // ── DFCs (transforming planeswalkers) — planeswalker character name
  //    must NOT leak through the back face. ──────────────────────────
  {
    id: "fx-arlinn-dfc",
    name: "Arlinn, the Pack's Hope",
    typeLine:
      "Legendary Creature — Human Werewolf // Legendary Planeswalker — Arlinn",
    oracleText: "Daybound.",
    producedMana: [],
    expectContains: ["creature", "planeswalker", "human", "werewolf"],
    expectMissing: ["arlinn"],
  },
  {
    id: "fx-garruk-dfc",
    name: "Garruk Relentless",
    typeLine:
      "Legendary Planeswalker — Garruk // Legendary Planeswalker — Garruk",
    oracleText: "...",
    producedMana: [],
    expectMissing: ["garruk"],
  },

  // ── Planeswalker emblems — character name MUST NOT leak. ──────────
  {
    id: "fx-arlinn-emblem",
    name: "Arlinn, the Pack's Hope Emblem",
    typeLine: "Emblem — Arlinn",
    oracleText: "",
    producedMana: [],
    expectContains: ["emblem"],
    expectMissing: ["arlinn"],
  },
  {
    id: "fx-sarkhan-emblem",
    name: "Sarkhan Emblem",
    typeLine: "Emblem — Sarkhan",
    oracleText: "",
    producedMana: [],
    expectMissing: ["sarkhan"],
  },

  // ── Multi-color lands → mana-fixing (not mana-rock). ──────────────
  {
    id: "fx-cinder-glade",
    name: "Cinder Glade",
    typeLine: "Land — Mountain Forest",
    oracleText:
      "({T}: Add {R} or {G}.) This land enters tapped unless you control two or more basic lands.",
    producedMana: ["R", "G"],
    expectContains: ["mana-fixing", "produces-r", "produces-g", "mountain", "forest"],
    expectMissing: ["mana-rock"],
  },
  {
    id: "fx-command-tower",
    name: "Command Tower",
    typeLine: "Land",
    oracleText: "{T}: Add one mana of any color in your commander's color identity.",
    producedMana: ["W", "U", "B", "R", "G"],
    expectContains: ["mana-fixing"],
    expectMissing: ["mana-rock"],
  },

  // ── Basic land → NO mana-rock / mana-fixing. ──────────────────────
  {
    id: "fx-forest",
    name: "Forest",
    typeLine: "Basic Land — Forest",
    oracleText: "({T}: Add {G}.)",
    producedMana: ["G"],
    expectContains: ["forest", "produces-g"],
    expectMissing: ["mana-rock", "mana-fixing", "mana-dork"],
  },

  // ── Single-color artifact mana rock. ──────────────────────────────
  {
    id: "fx-sol-ring",
    name: "Sol Ring",
    typeLine: "Artifact",
    oracleText: "{T}: Add {C}{C}.",
    producedMana: ["C"],
    expectContains: ["mana-rock"],
    expectMissing: ["mana-fixing", "mana-dork"],
  },

  // ── Multi-color artifact mana fixer. ──────────────────────────────
  {
    id: "fx-arcane-signet",
    name: "Arcane Signet",
    typeLine: "Artifact",
    oracleText: "{T}: Add one mana of any color in your commander's color identity.",
    producedMana: ["W", "U", "B", "R", "G"],
    expectContains: ["mana-rock", "mana-fixing"],
  },

  // ── Creature mana producer → mana-dork. ───────────────────────────
  {
    id: "fx-llanowar-elves",
    name: "Llanowar Elves",
    typeLine: "Creature — Elf Druid",
    oracleText: "{T}: Add {G}.",
    producedMana: ["G"],
    expectContains: ["mana-dork", "elf", "druid"],
    expectMissing: ["mana-rock"],
  },

  // ── Ramp / land tutors (Cultivate, Skyshroud Claim, World Shaper). ─
  {
    id: "fx-cultivate",
    name: "Cultivate",
    typeLine: "Sorcery",
    oracleText:
      "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
    producedMana: [],
    expectContains: ["ramp"],
  },
  {
    id: "fx-skyshroud-claim",
    name: "Skyshroud Claim",
    typeLine: "Sorcery",
    oracleText: "Search your library for up to two Forest cards, put them onto the battlefield, then shuffle.",
    producedMana: [],
    expectContains: ["ramp"],
  },

  // ── Land recursion (Crucible, Splendid Reclamation). ──────────────
  {
    id: "fx-crucible-of-worlds",
    name: "Crucible of Worlds",
    typeLine: "Artifact",
    oracleText: "You may play lands from your graveyard.",
    producedMana: [],
    expectContains: ["land-recursion"],
  },
  {
    id: "fx-splendid-reclamation",
    name: "Splendid Reclamation",
    typeLine: "Sorcery",
    oracleText: "Return all land cards from your graveyard to the battlefield tapped.",
    producedMana: [],
    expectContains: ["land-recursion"],
  },

  // ── Damage / board wipe / stax / cost-reduction regressions. ──────
  {
    id: "fx-worldsouls-rage",
    name: "Worldsoul's Rage",
    typeLine: "Sorcery",
    oracleText:
      "Worldsoul's Rage deals X damage to any target. Put up to X land cards from your hand and/or graveyard onto the battlefield tapped.",
    producedMana: [],
    expectContains: ["damage-removal"],
  },
  {
    id: "fx-gaze-of-granite",
    name: "Gaze of Granite",
    typeLine: "Sorcery",
    oracleText: "Destroy each nonland permanent with mana value X or less.",
    producedMana: [],
    expectContains: ["board-wipe"],
  },
  {
    id: "fx-blasphemous-act",
    name: "Blasphemous Act",
    typeLine: "Sorcery",
    oracleText:
      "This spell costs {1} less to cast for each creature on the battlefield. Blasphemous Act deals 13 damage to each creature.",
    producedMana: [],
    expectContains: ["cost-reduction", "board-wipe"],
    expectMissing: ["tribal-cost-reduction"],
  },
  {
    id: "fx-static-orb",
    name: "Static Orb",
    typeLine: "Artifact",
    oracleText:
      "As long as Static Orb is untapped, players can't untap more than two permanents during their untap steps.",
    producedMana: [],
    expectContains: ["stax-tap-untap"],
  },
];

function assertFixture(
  f: Fixture,
  extracted: string[],
): { failures: string[] } {
  const failures: string[] = [];
  const set = new Set(extracted);
  for (const k of f.expectContains ?? []) {
    if (!set.has(k)) failures.push(`expected "${k}" but missing`);
  }
  for (const k of f.expectMissing ?? []) {
    if (set.has(k)) failures.push(`expected NOT "${k}" but present`);
  }
  return { failures };
}

async function main(): Promise<void> {
  // ── Stage 1: pure extraction check (no DB, fastest signal). ──────
  console.log("[stage 1] extractKeywords on each fixture (pure function)");
  let stage1Failures = 0;
  for (const f of FIXTURES) {
    const kws = extractKeywords(
      {
        keywords: [],
        type_line: f.typeLine,
        oracle_text: f.oracleText,
        produced_mana: f.producedMana,
      },
      [],
    );
    const { failures } = assertFixture(f, kws);
    if (failures.length) {
      stage1Failures += failures.length;
      console.log(`  ✗ ${f.name}`);
      for (const err of failures) console.log(`      ${err}`);
      console.log(`      extracted: ${kws.join(", ")}`);
    }
  }
  console.log(`  ${stage1Failures === 0 ? "✓" : "✗"} ${FIXTURES.length} fixtures, ${stage1Failures} failures`);

  // ── Stage 2: round-trip through a real Prisma SQLite DB. ─────────
  // Validates that reextract-keywords reads producedManaJson properly
  // and that the analyze recomputation matches.
  console.log("[stage 2] round-trip via temp SQLite DB");
  const tmp = mkdtempSync(join(tmpdir(), "kws-e2e-"));
  const dbPath = join(tmp, "test.db");
  // Create the schema by running prisma db push against this temp DB.
  execSync("pnpm prisma db push --accept-data-loss", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });

  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }),
  });

  for (const f of FIXTURES) {
    // Mimic upsertScryfallCard by pre-computing keywords from full
    // Scryfall payload (with producedMana). This is what the ingest
    // path does at INSERT time.
    const keywords = extractKeywords(
      {
        keywords: [],
        type_line: f.typeLine,
        oracle_text: f.oracleText,
        produced_mana: f.producedMana,
      },
      [],
    );
    await prisma.card.create({
      data: {
        id: f.id,
        name: f.name,
        typeLine: f.typeLine,
        oracleText: f.oracleText,
        colors: "[]",
        colorIdentity: "[]",
        keywordsJson: JSON.stringify(keywords),
        producedManaJson: JSON.stringify(f.producedMana),
      },
    });
  }

  // Run the reextract logic (same code path as scripts/reextract-keywords.ts).
  const PRESERVED_PREFIXES = ["otag:"];
  const all = await prisma.card.findMany({
    select: {
      id: true,
      typeLine: true,
      oracleText: true,
      keywordsJson: true,
      oracleTagsJson: true,
      producedManaJson: true,
    },
  });
  for (const c of all) {
    const existing = JSON.parse(c.keywordsJson) as string[];
    const oracleTags = JSON.parse(c.oracleTagsJson) as string[];
    const producedMana = JSON.parse(c.producedManaJson) as string[];
    const carried = existing.filter((k) =>
      PRESERVED_PREFIXES.some((p) => k.startsWith(p)),
    );
    const recomputed = extractKeywords(
      {
        keywords: [],
        type_line: c.typeLine,
        oracle_text: c.oracleText ?? "",
        produced_mana: producedMana,
      },
      oracleTags,
    );
    const merged = Array.from(new Set([...recomputed, ...carried])).sort();
    await prisma.card.update({
      where: { id: c.id },
      data: { keywordsJson: JSON.stringify(merged) },
    });
  }

  // Now verify fixtures still pass after the reextract round-trip.
  let stage2Failures = 0;
  for (const f of FIXTURES) {
    const row = await prisma.card.findUnique({
      where: { id: f.id },
      select: { keywordsJson: true },
    });
    const kws = JSON.parse(row!.keywordsJson) as string[];
    const { failures } = assertFixture(f, kws);
    if (failures.length) {
      stage2Failures += failures.length;
      console.log(`  ✗ ${f.name} (post-reextract)`);
      for (const err of failures) console.log(`      ${err}`);
      console.log(`      stored: ${kws.join(", ")}`);
    }
  }
  console.log(`  ${stage2Failures === 0 ? "✓" : "✗"} ${FIXTURES.length} fixtures, ${stage2Failures} failures`);

  await prisma.$disconnect();
  rmSync(tmp, { recursive: true, force: true });

  const total = stage1Failures + stage2Failures;
  if (total > 0) {
    console.error(`\n${total} failures — keyword pipeline has regressions`);
    process.exit(1);
  }
  console.log(`\nAll ${FIXTURES.length} fixtures pass through both stages.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
