/**
 * Seeds the SQLite DB with a small hand-curated card set so the app is
 * demo-able without hitting Scryfall. Run with `pnpm seed`.
 *
 * For a full corpus, use `pnpm ingest` (bulk Scryfall download).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { extractKeywords } from "../src/lib/synergy/keywords";
import type { ScryfallCard } from "../src/lib/scryfall";

const prisma = new PrismaClient();

async function main() {
  const path = resolve(process.cwd(), "data/fixtures.json");
  const raw = await readFile(path, "utf8");
  const cards = JSON.parse(raw) as ScryfallCard[];
  console.log(`Loading ${cards.length} fixture cards...`);

  for (const c of cards) {
    // Preserve any oracle tags already in the DB from a previous
    // `pnpm ingest:tags` run, so re-seeding fixtures doesn't wipe them.
    const existing = await prisma.card.findUnique({
      where: { id: c.oracle_id ?? c.id },
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
      where: { id: c.oracle_id ?? c.id },
      create: {
        id: c.oracle_id ?? c.id,
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
        oracleTagsJson: JSON.stringify(oracleTags),
        imageSmall: images?.small ?? null,
        imageNormal: images?.normal ?? null,
        scryfallUri: c.scryfall_uri ?? null,
        edhrecRank: c.edhrec_rank ?? null,
      },
      update: {
        keywordsJson: JSON.stringify(keywords),
        oracleText: c.oracle_text ?? null,
      },
    });
  }
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
