/**
 * Seeds the SQLite DB with a small hand-curated card set so the app is
 * demo-able without hitting Scryfall. Run with `pnpm seed`.
 *
 * For a full corpus, use `pnpm ingest` (bulk Scryfall download).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import { extractKeywords } from "../src/lib/synergy/keywords";
import type { ScryfallCard } from "../src/lib/scryfall";

async function main() {
  // Fixtures are bundled with the image at /app/seeds/ in production, and
  // at <repo>/seeds/ in dev. Both resolve from cwd via the same relative path.
  const path = resolve(process.cwd(), "seeds/fixtures.json");
  const raw = await readFile(path, "utf8");
  const cards = JSON.parse(raw) as ScryfallCard[];
  console.log(`Loading ${cards.length} fixture cards...`);

  let created = 0;
  let refreshed = 0;
  let skipped = 0;

  for (const c of cards) {
    // Fixtures use synthetic IDs like "fixture-sol-ring". If the user has
    // already pasted a real deck, the DB may contain "Sol Ring" with a
    // real Scryfall oracle_id. The schema has unique constraints on BOTH
    // id and name, so a naive upsert(where: {id}) tries to INSERT and
    // dies with P2002 on the name. Look up by EITHER and update in place.
    const fixtureId = c.oracle_id ?? c.id;
    const existing = await prisma.card.findFirst({
      where: { OR: [{ id: fixtureId }, { name: c.name }] },
      select: { id: true, oracleTagsJson: true },
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

    if (existing) {
      // Real Scryfall data takes precedence over fixtures — only refresh
      // the computed keyword set (in case extractKeywords logic improved).
      // Don't touch id/name/images/etc.
      if (existing.id !== fixtureId) {
        skipped += 1;
      } else {
        await prisma.card.update({
          where: { id: existing.id },
          data: { keywordsJson: JSON.stringify(keywords) },
        });
        refreshed += 1;
      }
      continue;
    }

    // Brand-new card: insert from the fixture data.
    const images = c.image_uris ?? c.card_faces?.[0]?.image_uris;
    await prisma.card.create({
      data: {
        id: fixtureId,
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
    });
    created += 1;
  }
  console.log(
    `Done. ${created} created, ${refreshed} refreshed, ${skipped} skipped (already present from a real Scryfall lookup).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
