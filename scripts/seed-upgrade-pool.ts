/**
 * Resolves the World Shaper upgrade-pool card names against Scryfall and
 * upserts them into the local DB so they appear as candidates in the
 * sidebar. Run AFTER `pnpm seed` (or `pnpm ingest`) and with internet access
 * to Scryfall.
 *
 *   pnpm tsx scripts/seed-upgrade-pool.ts
 *
 * The card name list lives in seeds/world-shaper-upgrade-pool.json and reflects
 * the upgrade recommendations from the CoolStuffInc article cited there.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import { getCardByName, sleep } from "../src/lib/scryfall";
import { upsertScryfallCard } from "../src/lib/card-upsert";

async function main() {
  const path = resolve(process.cwd(), "seeds/world-shaper-upgrade-pool.json");
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
    await upsertScryfallCard(sc);
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
