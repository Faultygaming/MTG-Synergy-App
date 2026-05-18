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
import {
  scoreCandidateByThemes,
  themeTier,
  type ThemeMatch,
} from "./themes";

export function keywordFrequency(
  deck: DeckEntry[],
  excludeKeywords?: ReadonlySet<string>,
): KeywordFrequency[] {
  const counts = new Map<string, number>();
  for (const entry of deck) {
    // Each unique keyword on a card counts once per copy of that card. For
    // most decks quantity is 1, but commander/limited can have basics x10+.
    for (const k of entry.card.keywords) {
      if (excludeKeywords?.has(k)) continue;
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

// Internal helper: builds a flat Set of every keyword that appears anywhere
// in the deck. Called once per rankCandidates() invocation and reused for
// every candidate, instead of rebuilt per-call (5x speedup at 2000
// candidates — see src/lib/synergy/score.bench.ts).
function deckKeywordSet(
  deck: DeckEntry[],
  excludeKeywords?: ReadonlySet<string>,
): Set<string> {
  const s = new Set<string>();
  for (const e of deck) {
    for (const k of e.card.keywords) {
      if (excludeKeywords?.has(k)) continue;
      s.add(k);
    }
  }
  return s;
}

// Returns up to three keyword strings: [primary, secondary, tertiary].
// Slots are filled greedily; if the deck only has two distinct keywords the
// tertiary slot will be undefined. `excludeKeywords` removes stoplisted
// terms from consideration so the top three reflect actual synergy
// themes instead of "the deck has creatures and lands".
export function topThreeKeywords(
  deck: DeckEntry[],
  excludeKeywords?: ReadonlySet<string>,
): {
  primary?: string;
  secondary?: string;
  tertiary?: string;
} {
  const freqs = keywordFrequency(deck, excludeKeywords);
  return {
    primary: freqs[0]?.keyword,
    secondary: freqs[1]?.keyword,
    tertiary: freqs[2]?.keyword,
  };
}

export function scoreCandidate(
  candidate: CardSummary,
  deck: DeckEntry[],
  top = topThreeKeywords(deck),
  // Caller may pass a precomputed deck-keyword Set when scoring many
  // candidates against the same deck. Optional for callsites that only
  // score one card; required by `rankCandidates` for batching speed.
  deckKeywords?: Set<string>,
  // Theme-based scoring (the post-May-2026 design). When provided,
  // the candidate's tier comes from THEME match strength (gold = closes
  // a loop the deck is missing; silver = moderate on 2+ themes; bronze
  // = moderate on 1 / weak-only) rather than raw top-3 keyword match.
  // The keyword tier is still computed as a fallback for callers that
  // don't pre-compute themes (the existing search route, benchmarks,
  // older tests).
  deckThemes?: ThemeMatch[],
): SynergySuggestion {
  const deckKws = deckKeywords ?? deckKeywordSet(deck);

  // Single pass: compute `shared` (∩ with deck) AND keyword-tier
  // eligibility (matches against the top 3) in one loop. Tier collapses
  // to gold > silver > bronze at the end so the iteration order of
  // `cardKws` doesn't matter.
  const cardKws = candidate.keywords;
  const { primary, secondary, tertiary } = top;
  const shared: string[] = [];
  let hasPrimary = false;
  let hasSecondary = false;
  let hasTertiary = false;
  for (const k of cardKws) {
    if (deckKws.has(k)) shared.push(k);
    if (k === primary) hasPrimary = true;
    else if (k === secondary) hasSecondary = true;
    else if (k === tertiary) hasTertiary = true;
  }
  const keywordTier: Tier | null = hasPrimary
    ? "gold"
    : hasSecondary
      ? "silver"
      : hasTertiary
        ? "bronze"
        : null;

  // If themes were provided, prefer theme-derived tier + rationale.
  // The strongest theme match (sorted strong > moderate > weak) provides
  // the headline rationale; the rest are kept in themeMatches for the UI
  // to expose on hover/expand.
  let tier: Tier | null = keywordTier;
  let rationale: string | undefined;
  let themeMatches:
    | SynergySuggestion["themeMatches"]
    | undefined;
  if (deckThemes && deckThemes.length > 0) {
    const matches = scoreCandidateByThemes(candidate, deckThemes);
    const tTier = themeTier(matches);
    if (tTier) tier = tTier; // theme tier wins when present
    if (matches.length > 0) {
      // Headline rationale: the strongest match. Signal ordering: strong > moderate > weak.
      const SIGNAL_ORDER = { strong: 0, moderate: 1, weak: 2 } as const;
      const sortedMatches = [...matches].sort(
        (a, b) => SIGNAL_ORDER[a.signal] - SIGNAL_ORDER[b.signal],
      );
      rationale = sortedMatches[0].rationale;
      themeMatches = sortedMatches;
    }
  }

  return {
    card: candidate,
    sharedKeywords: shared.sort(),
    tier,
    shareCount: shared.length,
    rationale,
    themeMatches,
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
//
// Performance note: hoists the deck-keyword Set construction out of the
// per-candidate path. With 99-card deck × 2000 candidates this drops
// ~5x of wasted Set inserts; see src/lib/synergy/score.bench.ts for
// before/after numbers.
//
// `excludeKeywords` (typically the stoplist) is applied in BOTH the
// top-3 selection AND the deck-keyword Set, so a candidate matching
// only stoplisted terms scores 0 instead of getting tiered for
// matching "creature".
export function rankCandidates(
  candidates: CardSummary[],
  deck: DeckEntry[],
  excludeKeywords?: ReadonlySet<string>,
  // Pre-detected deck themes. Pass through to scoreCandidate so theme
  // tier overrides keyword tier. Computed once by the caller (deck page)
  // and reused across the whole candidate pool.
  deckThemes?: ThemeMatch[],
): SynergySuggestion[] {
  // Exclude cards already in the deck.
  const inDeck = new Set(deck.map((e) => e.card.id));
  const top = topThreeKeywords(deck, excludeKeywords);
  const deckKws = deckKeywordSet(deck, excludeKeywords);
  const scored: SynergySuggestion[] = [];
  for (const c of candidates) {
    if (inDeck.has(c.id)) continue;
    scored.push(scoreCandidate(c, deck, top, deckKws, deckThemes));
  }
  return rankSuggestions(scored);
}
