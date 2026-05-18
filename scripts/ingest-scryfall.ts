/**
 * Bulk ingest of the Scryfall `oracle_cards` JSON into SQLite.
 *
 * Pipeline:
 *   1. GET https://api.scryfall.com/bulk-data → find the oracle_cards manifest entry.
 *   2. Download the manifest's `download_uri` (one big JSON array of cards).
 *   3. For each card, extract keywords via lib/synergy/keywords.ts and upsert.
 *
 * The download is ~120 MB; the script streams to disk first to keep memory
 * usage flat. The cached file lives at data/scryfall-bulk/oracle-cards.json
 * and is reused on re-runs unless `--force` is passed.
 *
 * Usage: pnpm ingest [--force]
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { prisma } from "../src/lib/db";
import { upsertScryfallCard } from "../src/lib/card-upsert";
import type { ScryfallCard } from "../src/lib/scryfall";
const FORCE = process.argv.includes("--force");
// Optional override: `--file <path>` ingests from a local JSON file
// instead of fetching the Scryfall bulk archive. Used by the validation
// smoke suite to exercise the upsert path against synthetic data without
// hitting the network.
const FILE_FLAG_IDX = process.argv.indexOf("--file");
const FILE_OVERRIDE =
  FILE_FLAG_IDX > -1 ? process.argv[FILE_FLAG_IDX + 1] : null;

interface BulkEntry {
  type: string;
  download_uri: string;
  updated_at: string;
  size: number;
}

async function findOracleBulk(): Promise<BulkEntry> {
  const res = await fetch("https://api.scryfall.com/bulk-data", {
    headers: {
      Accept: "application/json",
      "User-Agent": process.env.SCRYFALL_USER_AGENT ?? "MTGSynergyMap/0.1 (local-dev)",
    },
  });
  if (!res.ok) throw new Error(`Scryfall bulk-data ${res.status}`);
  const body = (await res.json()) as { data: BulkEntry[] };
  const entry = body.data.find((e) => e.type === "oracle_cards");
  if (!entry) throw new Error("oracle_cards bulk entry not found");
  return entry;
}

async function downloadIfMissing(url: string, dest: string) {
  try {
    if (!FORCE && (await stat(dest)).size > 0) {
      console.log(`Using cached ${dest}`);
      return;
    }
  } catch {
    /* fallthrough: file doesn't exist */
  }
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}`);
  // @ts-expect-error Web ReadableStream → Node stream interop is well-supported in Node 22.
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log("Download complete.");
}

async function main() {
  let dest: string;
  if (FILE_OVERRIDE) {
    dest = resolve(FILE_OVERRIDE);
    console.log(`Reading from override file ${dest} (skipping Scryfall download)`);
  } else {
    const dir = resolve(process.cwd(), "data/scryfall-bulk");
    await mkdir(dir, { recursive: true });
    dest = resolve(dir, "oracle-cards.json");
    const entry = await findOracleBulk();
    await downloadIfMissing(entry.download_uri, dest);
  }

  console.log("Parsing JSON (this may take a moment)...");
  const cards = JSON.parse(await readFile(dest, "utf8")) as ScryfallCard[];
  console.log(`Ingesting ${cards.length} oracle cards...`);

  let i = 0;
  let created = 0;
  let updated = 0;
  let merged = 0; // existing-by-name-with-different-id (fixture carryover)
  for (const c of cards) {
    if (!c.oracle_id) continue;
    // The unique constraints on BOTH id AND name make a naive upsert
    // crash with P2002 when a fixture row already has the same name.
    // upsertScryfallCard() handles both cases via findFirst({OR}).
    const r = await upsertScryfallCard(c);
    if (r.created) created += 1;
    else if (r.idMismatch) merged += 1;
    else updated += 1;
    if (++i % 500 === 0) console.log(`  ${i}/${cards.length}`);
  }
  console.log(
    `Ingest complete. ${created} created, ${updated} refreshed, ${merged} merged into existing rows.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
