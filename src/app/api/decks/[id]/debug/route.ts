import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  keywordFrequency,
  topThreeKeywords,
  scoreCandidate,
} from "@/lib/synergy/score";
import { COMMON_KEYWORD_STOPLIST } from "@/lib/synergy/stoplist";
import type { DeckEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

interface CardRow {
  id: string;
  name: string;
  typeLine: string;
  manaCost: string | null;
  colors: string;
  colorIdentity: string;
  oracleText: string | null;
  imageSmall: string | null;
  imageNormal: string | null;
  scryfallUri: string | null;
  keywordsJson: string;
}

function rowToSummary(r: CardRow) {
  return {
    id: r.id,
    name: r.name,
    typeLine: r.typeLine,
    manaCost: r.manaCost,
    colors: JSON.parse(r.colors) as string[],
    imageSmall: r.imageSmall,
    imageNormal: r.imageNormal,
    scryfallUri: r.scryfallUri,
    keywords: JSON.parse(r.keywordsJson) as string[],
  };
}

// GET /api/decks/[id]/debug?probe=<name>
//
// Diagnostic dump for the deck's synergy scoring pipeline. Returns:
//   - top3:          the deck's gold/silver/bronze keyword slots
//   - histogram:     every non-stoplist keyword in the deck, ranked, with
//                    the list of card names contributing it (so it's
//                    obvious WHY a keyword is or isn't in top-3)
//   - stoplistApplied: which stoplist entries actually fired against this
//                    deck (helps spot accidentally over-broad filters)
//   - probe:         if ?probe=<name> is set, find that card in the DB
//                    and show how it would score against THIS deck — its
//                    tier, shared keywords, and which top-3 slots it
//                    matches. Use to verify "why isn't Crucible tiered?"
//
// Read-only; safe to hit repeatedly.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const probeName = url.searchParams.get("probe");

  const deck = await prisma.deck.findUnique({
    where: { id },
    include: { cards: { include: { card: true } } },
  });
  if (!deck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const entries: DeckEntry[] = deck.cards.map((dc) => ({
    card: rowToSummary(dc.card as unknown as CardRow),
    quantity: dc.quantity,
  }));

  // Full histogram WITHOUT stoplist, so we can see what's getting dropped.
  const rawHistogram = keywordFrequency(entries);
  // Histogram WITH stoplist applied — same input to topThreeKeywords.
  const filteredHistogram = keywordFrequency(entries, COMMON_KEYWORD_STOPLIST);
  const top = topThreeKeywords(entries, COMMON_KEYWORD_STOPLIST);

  // For each non-stoplist keyword, list the deck cards that contribute it.
  // Truncate the card list so the response stays manageable on big decks.
  const contributors = new Map<string, string[]>();
  for (const e of entries) {
    for (const k of e.card.keywords) {
      if (COMMON_KEYWORD_STOPLIST.has(k)) continue;
      const list = contributors.get(k) ?? [];
      list.push(e.card.name);
      contributors.set(k, list);
    }
  }
  const histogramWithCards = filteredHistogram.slice(0, 40).map((h) => ({
    keyword: h.keyword,
    count: h.count,
    cards: (contributors.get(h.keyword) ?? []).slice(0, 8),
  }));

  // Which stoplist entries actually appeared in the deck (useful to spot
  // a stoplist entry that's accidentally suppressing a real archetype).
  const stoplistApplied: Array<{ keyword: string; count: number }> = [];
  const allHistogramMap = new Map(rawHistogram.map((h) => [h.keyword, h.count]));
  for (const k of COMMON_KEYWORD_STOPLIST) {
    const c = allHistogramMap.get(k);
    if (c) stoplistApplied.push({ keyword: k, count: c });
  }
  stoplistApplied.sort((a, b) => b.count - a.count);

  // Optional probe: score a specific card by name against this deck.
  let probe: unknown = null;
  if (probeName) {
    const row = (await prisma.card.findFirst({
      where: { name: { contains: probeName } },
    })) as unknown as CardRow | null;
    if (row) {
      const summary = rowToSummary(row);
      const suggestion = scoreCandidate(summary, entries, top);
      probe = {
        name: summary.name,
        typeLine: summary.typeLine,
        keywords: summary.keywords,
        tier: suggestion.tier,
        shareCount: suggestion.shareCount,
        sharedKeywords: suggestion.sharedKeywords,
        whyTier: {
          deckPrimary: top.primary,
          deckSecondary: top.secondary,
          deckTertiary: top.tertiary,
          matchedPrimary: top.primary ? summary.keywords.includes(top.primary) : false,
          matchedSecondary: top.secondary ? summary.keywords.includes(top.secondary) : false,
          matchedTertiary: top.tertiary ? summary.keywords.includes(top.tertiary) : false,
        },
      };
    } else {
      probe = { error: `No card found matching "${probeName}"` };
    }
  }

  return NextResponse.json({
    deck: {
      id: deck.id,
      name: deck.name,
      format: deck.format,
      cardCount: entries.reduce((n, e) => n + e.quantity, 0),
    },
    top3: top,
    histogram: histogramWithCards,
    stoplistApplied: stoplistApplied.slice(0, 20),
    probe,
  });
}
