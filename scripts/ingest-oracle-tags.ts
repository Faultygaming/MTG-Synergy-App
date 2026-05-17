/**
 * Ingest Scryfall oracle tags into the local DB.
 *
 * For each tag in data/oracle-tags.json, queries
 *   https://api.scryfall.com/cards/search?q=otag:<tag>
 * with pagination, accumulates a card-oracle-id → tags map, then writes
 * each card's tag array to `Card.oracleTagsJson`. After running this,
 * re-run `pnpm seed` (or any extractKeywords path) and the oracle tags
 * will union into the per-card keyword set as `otag:*`.
 *
 * Network-bound — must be run from an environment that can reach
 * api.scryfall.com (the sandboxed Claude Code env cannot). Polite by
 * default: ~120ms between paginated requests, custom User-Agent.
 *
 * Usage:
 *   pnpm tsx scripts/ingest-oracle-tags.ts                    # all tags
 *   pnpm tsx scripts/ingest-oracle-tags.ts ramp removal       # subset
 *
 * Expected runtime: ~5–10 minutes for the full curated list against a
 * fully-ingested DB. The Card row must exist (via `pnpm ingest` or per-card
 * lookups) for tags to land; cards Scryfall returns that aren't in our DB
 * are skipped with a counter at the end.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { searchCards, sleep, type ScryfallCard } from "../src/lib/scryfall";

const prisma = new PrismaClient();

async function loadTagList(): Promise<string[]> {
  const path = resolve(process.cwd(), "data/oracle-tags.json");
  const raw = JSON.parse(await readFile(path, "utf8")) as { tags: string[] };
  return raw.tags;
}

async function main() {
  const all = await loadTagList();
  const argv = process.argv.slice(2);
  const tags = argv.length > 0 ? argv : all;
  console.log(`Ingesting ${tags.length} oracle tag(s)...`);

  // Card oracle_id → Set<tag>
  const cardTags = new Map<string, Set<string>>();
  let totalHits = 0;
  let totalSkipped = 0;

  for (const [i, tag] of tags.entries()) {
    process.stdout.write(`[${i + 1}/${tags.length}] otag:${tag} ... `);
    let cards: ScryfallCard[];
    try {
      // 10 pages × ~175 cards/page = 1,750 cards max per tag. Few tags
      // have more than that; cap is a guardrail more than a real limit.
      cards = await searchCards(`otag:${tag}`, 10);
    } catch (err) {
      console.warn(`  failed: ${(err as Error).message}`);
      await sleep(500);
      continue;
    }
    console.log(`${cards.length} cards`);
    totalHits += cards.length;
    for (const c of cards) {
      const id = c.oracle_id ?? c.id;
      if (!cardTags.has(id)) cardTags.set(id, new Set());
      cardTags.get(id)!.add(tag);
    }
    // Inter-tag courtesy beat in addition to per-page sleeping inside searchCards.
    await sleep(200);
  }

  console.log(`\nApplying tags to ${cardTags.size} cards in the DB...`);
  let applied = 0;
  for (const [oracleId, tagSet] of cardTags) {
    const existing = await prisma.card.findUnique({
      where: { id: oracleId },
      select: { id: true, keywordsJson: true, oracleTagsJson: true },
    });
    if (!existing) {
      totalSkipped += 1;
      continue;
    }
    const tagList = Array.from(tagSet).sort();
    // Union new tags into the keyword set as otag:* so the synergy ranker
    // picks them up without a follow-up pass.
    const keywords = new Set(JSON.parse(existing.keywordsJson) as string[]);
    for (const t of tagList) keywords.add(`otag:${t}`);
    await prisma.card.update({
      where: { id: existing.id },
      data: {
        oracleTagsJson: JSON.stringify(tagList),
        keywordsJson: JSON.stringify(Array.from(keywords).sort()),
      },
    });
    applied += 1;
    if (applied % 200 === 0) console.log(`  ${applied}/${cardTags.size}`);
  }

  console.log(
    `\nDone. ${totalHits} tag-card hits across ${tags.length} tags; ${applied} cards updated, ${totalSkipped} skipped (not in local DB — run \`pnpm ingest\` first).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
