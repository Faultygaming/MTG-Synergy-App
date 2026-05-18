import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rankCandidates, scoreCandidate, topThreeKeywords } from "@/lib/synergy/score";
import { detectDeckThemes } from "@/lib/synergy/themes";
import { COMMON_KEYWORD_STOPLIST } from "@/lib/synergy/stoplist";
import {
  isCandidateLegal,
  DEFAULT_CONFIG,
  type CommanderLegalityCard,
  type CommanderRulesConfig,
} from "@/lib/commander/rules";
import type { CardSummary, DeckEntry, SynergySuggestion } from "@/lib/types";

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

function rowToSummary(r: CardRow): CardSummary {
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

function rowToLegality(r: CardRow): CommanderLegalityCard {
  return {
    ...rowToSummary(r),
    colorIdentity: JSON.parse(r.colorIdentity) as string[],
    oracleText: r.oracleText,
  };
}

// GET /api/cards/search?q=<name>&deck=<id>&limit=<n>
//
// Searches the WHOLE local card DB by name substring, then re-ranks the
// hits against the given deck's keyword frequencies so synergy scores
// surface naturally even for cards that didn't make the default top-N
// suggestion cutoff. Used by the deck-page sidebar when the user types
// in the filter box — local-only filtering of the top-60 list would
// miss any card outside that window (e.g. "Crucible of Worlds" when the
// default rank put it at #134).
//
// Commander color-identity + banlist filtering applied if the deck is
// in commander format.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const deckId = url.searchParams.get("deck");
  const limit = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "60", 10)),
  );

  if (q.length < 2 || !deckId) {
    return NextResponse.json({ results: [] });
  }

  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: { cards: { include: { card: true } } },
  });
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  const entries: DeckEntry[] = deck.cards.map((dc) => ({
    card: rowToSummary(dc.card as unknown as CardRow),
    quantity: dc.quantity,
  }));
  const top = topThreeKeywords(entries, COMMON_KEYWORD_STOPLIST);
  // Theme-aware tier (Phase 1+2 of the synergy refactor): each search
  // result picks up a rationale + theme tier matching the deck page.
  const deckThemes = detectDeckThemes(entries);
  const rulesConfig: CommanderRulesConfig = {
    ...DEFAULT_CONFIG,
    ...(JSON.parse(deck.rulesConfigJson || "{}") as Partial<CommanderRulesConfig>),
  };
  const commanderIds = [deck.commanderId, deck.partnerId].filter(Boolean) as string[];
  const commanderRows = commanderIds.length
    ? ((await prisma.card.findMany({ where: { id: { in: commanderIds } } })) as unknown as CardRow[])
    : [];
  const commanders: CommanderLegalityCard[] = commanderRows.map(rowToLegality);
  const inDeck = new Set([...entries.map((e) => e.card.id), ...commanderIds]);

  // Match against BOTH name and the JSON-encoded keyword array. The
  // latter lets the user type a keyword (e.g. "landfall", "etb-trigger")
  // and surface every card with that keyword — not just the lone card
  // whose printed name contains the substring. keywordsJson is stored
  // lower-kebab-case (e.g. `["landfall","creature","produces-g"]`), so
  // the query is lowercased before substring matching.
  const qLower = q.toLowerCase();
  const matches = (await prisma.card.findMany({
    where: {
      OR: [
        { name: { contains: q } },
        { keywordsJson: { contains: qLower } },
      ],
    },
    take: 300,
  })) as unknown as CardRow[];

  // Pre-build the deck's NON-STOPLIST keyword set once, and pass it to
  // scoreCandidate via its deckKeywords param. Without this, the
  // `sharedKeywords` returned would include stoplisted noise terms
  // (`land`, `produces-b`, `artifact`, …) since scoreCandidate's
  // default deckKeywords = union of ALL deck keywords with no filter.
  // The displayed caption would then leak those.
  const filteredDeckKws = new Set<string>();
  for (const e of entries) {
    for (const k of e.card.keywords) {
      if (COMMON_KEYWORD_STOPLIST.has(k)) continue;
      filteredDeckKws.add(k);
    }
  }

  const filtered: SynergySuggestion[] = [];
  for (const row of matches) {
    if (inDeck.has(row.id)) continue;
    const legality = rowToLegality(row);
    if (
      deck.format === "commander" &&
      !isCandidateLegal(legality, commanders, rulesConfig)
    ) {
      continue;
    }
    filtered.push(
      scoreCandidate(
        rowToSummary(row),
        entries,
        top,
        filteredDeckKws,
        deckThemes,
      ),
    );
  }

  // Sort: tiered (gold > silver > bronze) first, then by share count, then
  // by name. Untiered hits still surface (the user explicitly searched
  // for them) but rank below tiered ones.
  const TIER_ORDER = { gold: 0, silver: 1, bronze: 2 } as const;
  filtered.sort((a, b) => {
    if (a.tier && !b.tier) return -1;
    if (!a.tier && b.tier) return 1;
    if (a.tier && b.tier && a.tier !== b.tier) {
      return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    }
    if (a.shareCount !== b.shareCount) return b.shareCount - a.shareCount;
    return a.card.name.localeCompare(b.card.name);
  });

  // Suppress unused-import warnings for the imports that future
  // enhancements (e.g. a "find any card globally" variant of this
  // endpoint) may pull in. rankCandidates isn't used here because we
  // score one-at-a-time over the search hits.
  void rankCandidates;

  return NextResponse.json({ results: filtered.slice(0, limit) });
}
