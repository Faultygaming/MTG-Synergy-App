/**
 * Resolves the World Shaper upgrade-pool card names against Scryfall and
 * upserts them into the local DB so they appear as candidates in the
 * sidebar. Run AFTER `pnpm seed` (or `pnpm ingest`) and with internet access
 * to Scryfall.
 *
 *   pnpm tsx scripts/seed-upgrade-pool.ts
 *
 * The card name list lives in data/world-shaper-upgrade-pool.json and reflects
 * the upgrade recommendations from the CoolStuffInc article cited there.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { getCardByName, toCardSummary, sleep } from "../src/lib/scryfall";
import { extractKeywords } from "../src/lib/synergy/keywords";

const prisma = new PrismaClient();

async function main() {
  const path = resolve(process.cwd(), "data/world-shaper-upgrade-pool.json");
  const { cards, commander } = JSON.parse(await readFile(path, "utf8")) as {
    cards: string[];
    commander: string;
  };
  const names = [commander, ...cards];
  console.log(`Resolving ${names.length} cards via Scryfall...`);

  let ok = 0;
  const missing: string[] = [];
  for (const name of names) {
    const existing = await prisma.card.findUnique({ where: { name } });
    if (existing) {
      ok += 1;
      continue;
    }
    const sc = await getCardByName(name);
    if (!sc) {
      missing.push(name);
      continue;
    }
    const summary = toCardSummary(sc);
    const keywords = extractKeywords(
      {
        keywords: sc.keywords ?? [],
        type_line: sc.type_line,
        oracle_text: sc.oracle_text ?? "",
        produced_mana: sc.produced_mana ?? [],
      },
      [],
    );
    await prisma.card.upsert({
      where: { id: summary.id },
      create: {
        id: summary.id,
        name: summary.name,
        manaCost: summary.manaCost ?? null,
        cmc: sc.cmc ?? null,
        typeLine: summary.typeLine,
        oracleText: sc.oracle_text ?? null,
        colors: JSON.stringify(summary.colors),
        colorIdentity: JSON.stringify(sc.color_identity ?? []),
        power: sc.power ?? null,
        toughness: sc.toughness ?? null,
        keywordsJson: JSON.stringify(keywords),
        imageSmall: summary.imageSmall ?? null,
        imageNormal: summary.imageNormal ?? null,
        scryfallUri: summary.scryfallUri ?? null,
        edhrecRank: sc.edhrec_rank ?? null,
      },
      update: { keywordsJson: JSON.stringify(keywords) },
    });
    ok += 1;
    await sleep(110); // Scryfall asks for ~10 req/s ceiling.
  }
  console.log(`Resolved ${ok}/${names.length}.`);
  if (missing.length) console.warn("Missing from Scryfall:", missing);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
