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
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { prisma } from "../src/lib/db";
import { upsertScryfallCard } from "../src/lib/card-upsert";
import type { ScryfallCard } from "../src/lib/scryfall";

// State file tracks the version of the last successfully-ingested bulk
// source. On subsequent runs we compare Scryfall's `updated_at` (or the
// file's mtime in --file mode) to the recorded value and skip the full
// ingest if nothing changed. Overridable via INGEST_STATE_FILE for tests.
const STATE_PATH =
  process.env.INGEST_STATE_FILE ??
  resolve(process.cwd(), "data/.ingest-state.json");

interface IngestState {
  version: 1;
  lastIngestedAt: string;     // Scryfall updated_at, or file mtime ISO
  lastIngestedSource: string; // "scryfall:bulk" or "file:<path>"
  lastIngestedCount: number;
  lastRunAt: string;
}

async function loadState(): Promise<IngestState | null> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8")) as IngestState;
  } catch {
    return null;
  }
}

async function writeIngestState(s: IngestState): Promise<void> {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(s, null, 2) + "\n");
}
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
  let sourceVersion: string;
  let sourceLabel: string;
  if (FILE_OVERRIDE) {
    dest = resolve(FILE_OVERRIDE);
    console.log(`Reading from override file ${dest} (skipping Scryfall download)`);
    const st = await stat(dest);
    sourceVersion = new Date(st.mtimeMs).toISOString();
    sourceLabel = `file:${dest}`;
  } else {
    const dir = resolve(process.cwd(), "data/scryfall-bulk");
    await mkdir(dir, { recursive: true });
    dest = resolve(dir, "oracle-cards.json");
    const entry = await findOracleBulk();
    sourceVersion = entry.updated_at;
    sourceLabel = "scryfall:bulk";
    await downloadIfMissing(entry.download_uri, dest);
  }

  // Skip the full ingest if our recorded state matches the bulk
  // source's version — saves the 37k-card upsert loop when nothing's
  // changed since the last run. `--force` bypasses the check.
  if (!FORCE) {
    const state = await loadState();
    if (
      state &&
      state.lastIngestedSource === sourceLabel &&
      state.lastIngestedAt === sourceVersion
    ) {
      console.log(
        `Already up to date — ${sourceLabel} version ${sourceVersion} was ingested ${state.lastIngestedCount} cards on ${state.lastRunAt}.`,
      );
      console.log("Pass --force to re-ingest anyway.");
      return;
    }
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
  await writeIngestState({
    version: 1,
    lastIngestedAt: sourceVersion,
    lastIngestedSource: sourceLabel,
    lastIngestedCount: created + updated + merged,
    lastRunAt: new Date().toISOString(),
  });
  console.log(`State saved to ${STATE_PATH}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
