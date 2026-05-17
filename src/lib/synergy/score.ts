// Synergy scoring + gold/silver/bronze tiering.
//
// The contract (from the project spec):
//   - Gold border  = candidate shares the deck's #1 most-frequent keyword.
//   - Silver       = candidate shares the deck's #2 most-frequent keyword
//                    (but NOT the #1).
//   - Bronze       = candidate shares the deck's #3 most-frequent keyword
//                    (but neither #1 nor #2).
//   - No tier      = no overlap with the deck's top-3 keywords.
//
// Ranking order across the whole sidebar:
//   gold (by shareCount desc), then silver (by shareCount desc), then bronze,
//   then untiered. Within a tier ties break by raw shareCount only — a "gold 3"
//   ranks above a "silver 5", per the user spec.

import type {
  CardSummary,
  DeckEntry,
  KeywordFrequency,
  SynergySuggestion,
  Tier,
} from "../types";

export function keywordFrequency(deck: DeckEntry[]): KeywordFrequency[] {
  const counts = new Map<string, number>();
  for (const entry of deck) {
    // Each unique keyword on a card counts once per copy of that card. For
    // most decks quantity is 1, but commander/limited can have basics x10+.
    for (const k of entry.card.keywords) {
      counts.set(k, (counts.get(k) ?? 0) + entry.quantity);
    }
  }
  return Array.from(counts, ([keyword, count]) => ({ keyword, count })).sort(
    (a, b) =>
      b.count - a.count ||
      // Stable tiebreak: alphabetical so the UI doesn't flicker.
      a.keyword.localeCompare(b.keyword),
  );
}

// Returns up to three keyword strings: [primary, secondary, tertiary].
// Slots are filled greedily; if the deck only has two distinct keywords the
// tertiary slot will be undefined.
export function topThreeKeywords(deck: DeckEntry[]): {
  primary?: string;
  secondary?: string;
  tertiary?: string;
} {
  const freqs = keywordFrequency(deck);
  return {
    primary: freqs[0]?.keyword,
    secondary: freqs[1]?.keyword,
    tertiary: freqs[2]?.keyword,
  };
}

function tierFor(
  candidateKeywords: Set<string>,
  top: { primary?: string; secondary?: string; tertiary?: string },
): Tier | null {
  if (top.primary && candidateKeywords.has(top.primary)) return "gold";
  if (top.secondary && candidateKeywords.has(top.secondary)) return "silver";
  if (top.tertiary && candidateKeywords.has(top.tertiary)) return "bronze";
  return null;
}

export function scoreCandidate(
  candidate: CardSummary,
  deck: DeckEntry[],
  top = topThreeKeywords(deck),
): SynergySuggestion {
  const deckKeywords = new Set<string>();
  for (const e of deck) for (const k of e.card.keywords) deckKeywords.add(k);

  const candidateKeywords = new Set(candidate.keywords);
  const shared: string[] = [];
  for (const k of candidateKeywords) {
    if (deckKeywords.has(k)) shared.push(k);
  }

  return {
    card: candidate,
    sharedKeywords: shared.sort(),
    tier: tierFor(candidateKeywords, top),
    shareCount: shared.length,
  };
}

const TIER_ORDER: Record<Tier, number> = { gold: 0, silver: 1, bronze: 2 };

export function rankSuggestions(suggestions: SynergySuggestion[]): SynergySuggestion[] {
  return [...suggestions].sort((a, b) => {
    // Tiered cards always rank ahead of untiered ones.
    if (a.tier && !b.tier) return -1;
    if (!a.tier && b.tier) return 1;
    if (a.tier && b.tier && a.tier !== b.tier) {
      return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    }
    // Same tier (or both untiered): rank by overlap size, then name.
    if (a.shareCount !== b.shareCount) return b.shareCount - a.shareCount;
    return a.card.name.localeCompare(b.card.name);
  });
}

// Convenience for callers that have a deck + candidate pool and want a sorted list.
export function rankCandidates(
  candidates: CardSummary[],
  deck: DeckEntry[],
): SynergySuggestion[] {
  // Exclude cards already in the deck.
  const inDeck = new Set(deck.map((e) => e.card.id));
  const top = topThreeKeywords(deck);
  const scored = candidates
    .filter((c) => !inDeck.has(c.id))
    .map((c) => scoreCandidate(c, deck, top));
  return rankSuggestions(scored);
}
