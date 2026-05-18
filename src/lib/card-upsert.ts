// Single source of truth for inserting/updating a Scryfall card into the
// local DB. Used by:
//
//   - scripts/ingest-scryfall.ts        (the bulk corpus loader)
//   - scripts/seed-upgrade-pool.ts      (article-driven candidate seeder)
//   - src/app/api/decks/route.ts        (per-card resolution on paste)
//
// The Card schema has unique constraints on BOTH `id` and `name`. A
// naive upsert(where: { id }) blows up with P2002 when a row already
// exists under the same name but a different id (e.g. a fixture row
// created by `pnpm seed` whose synthetic id doesn't match Scryfall's
// real oracle_id). This helper looks up by EITHER id OR name and
// preserves the existing row's id (so DeckCard FK relations stay intact)
// while refreshing all the printed fields from the new Scryfall data.
//
// Oracle tags previously attached via `pnpm ingest:tags` are preserved
// across re-ingest and unioned into the keyword set as `otag:*`.

import type { Card } from "@prisma/client";
import { prisma } from "./db";
import { extractKeywords } from "./synergy/keywords";
import { toCardSummary, type ScryfallCard } from "./scryfall";

export interface UpsertResult {
  card: Card;
  created: boolean;
  /** True when an existing-by-name row was matched whose id differs from
   * the incoming Scryfall oracle_id. Used by ingest scripts to flag
   * carry-over from fixture-id rows so the operator knows. */
  idMismatch: boolean;
}

export async function upsertScryfallCard(sc: ScryfallCard): Promise<UpsertResult> {
  const summary = toCardSummary(sc);
  const existing = await prisma.card.findFirst({
    where: { OR: [{ id: summary.id }, { name: summary.name }] },
    select: { id: true, oracleTagsJson: true },
  });
  const oracleTags = existing
    ? (JSON.parse(existing.oracleTagsJson) as string[])
    : [];
  const keywords = extractKeywords(
    {
      keywords: sc.keywords ?? [],
      type_line: sc.type_line,
      oracle_text: sc.oracle_text ?? "",
      produced_mana: sc.produced_mana ?? [],
    },
    oracleTags,
  );

  const images = sc.image_uris ?? sc.card_faces?.[0]?.image_uris;
  const sharedFields = {
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
    producedManaJson: JSON.stringify(sc.produced_mana ?? []),
    imageSmall: summary.imageSmall ?? null,
    imageNormal: summary.imageNormal ?? null,
    scryfallUri: summary.scryfallUri ?? null,
    edhrecRank: sc.edhrec_rank ?? null,
  };

  if (existing) {
    const card = await prisma.card.update({
      where: { id: existing.id },
      // Never change the existing id — DeckCard rows reference it.
      data: sharedFields,
    });
    return {
      card,
      created: false,
      idMismatch: existing.id !== summary.id,
    };
  }
  const card = await prisma.card.create({
    data: { id: summary.id, oracleTagsJson: "[]", ...sharedFields },
  });
  return { card, created: true, idMismatch: false };
}
