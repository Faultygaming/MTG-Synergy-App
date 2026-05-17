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
import { PrismaClient } from "@prisma/client";
import { extractKeywords } from "../src/lib/synergy/keywords";
import type { ScryfallCard } from "../src/lib/scryfall";

const prisma = new PrismaClient();
const FORCE = process.argv.includes("--force");

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
  const dir = resolve(process.cwd(), "data/scryfall-bulk");
  await mkdir(dir, { recursive: true });
  const dest = resolve(dir, "oracle-cards.json");

  const entry = await findOracleBulk();
  await downloadIfMissing(entry.download_uri, dest);

  console.log("Parsing JSON (this may take a moment)...");
  const cards = JSON.parse(await readFile(dest, "utf8")) as ScryfallCard[];
  console.log(`Ingesting ${cards.length} oracle cards...`);

  let i = 0;
  for (const c of cards) {
    if (!c.oracle_id) continue;
    // Preserve oracle tags from a prior `pnpm ingest:tags` run; bulk ingest
    // refreshes printed fields but tags are scoped to the otag: pipeline.
    const existing = await prisma.card.findUnique({
      where: { id: c.oracle_id },
      select: { oracleTagsJson: true },
    });
    const oracleTags = existing
      ? (JSON.parse(existing.oracleTagsJson) as string[])
      : [];
    const keywords = extractKeywords(
      {
        keywords: c.keywords ?? [],
        type_line: c.type_line,
        oracle_text: c.oracle_text ?? "",
        produced_mana: c.produced_mana ?? [],
      },
      oracleTags,
    );
    const images = c.image_uris ?? c.card_faces?.[0]?.image_uris;
    await prisma.card.upsert({
      where: { id: c.oracle_id },
      create: {
        id: c.oracle_id,
        name: c.name,
        manaCost: c.mana_cost ?? null,
        cmc: c.cmc ?? null,
        typeLine: c.type_line,
        oracleText: c.oracle_text ?? null,
        colors: JSON.stringify(c.colors ?? []),
        colorIdentity: JSON.stringify(c.color_identity ?? []),
        power: c.power ?? null,
        toughness: c.toughness ?? null,
        keywordsJson: JSON.stringify(keywords),
        imageSmall: images?.small ?? null,
        imageNormal: images?.normal ?? null,
        scryfallUri: c.scryfall_uri ?? null,
        edhrecRank: c.edhrec_rank ?? null,
      },
      update: {
        keywordsJson: JSON.stringify(keywords),
        oracleText: c.oracle_text ?? null,
        edhrecRank: c.edhrec_rank ?? null,
      },
    });
    if (++i % 500 === 0) console.log(`  ${i}/${cards.length}`);
  }
  console.log("Ingest complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
