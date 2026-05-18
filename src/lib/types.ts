// Shared domain types. The Prisma client provides storage types; this file
// describes the in-app "logical" card and synergy shapes used by UI/lib.

export type Tier = "gold" | "silver" | "bronze";

export interface CardSummary {
  id: string;
  name: string;
  typeLine: string;
  manaCost?: string | null;
  colors: string[];
  imageSmall?: string | null;
  imageNormal?: string | null;
  scryfallUri?: string | null;
  keywords: string[];
}

export interface DeckEntry {
  card: CardSummary;
  quantity: number;
}

export interface KeywordFrequency {
  keyword: string;
  count: number;
}

// One theme the candidate participates in for THIS deck. Mirror of the
// CandidateThemeMatch shape from synergy/themes.ts; duplicated here so
// client components (the sidebar, the removal panel) can render
// rationales without pulling the theme catalog into the client bundle.
export interface CandidateThemeMatch {
  themeId: string;
  themeLabel: string;
  cardRole: "enabler" | "payoff" | "neutral";
  signal: "strong" | "moderate" | "weak";
  rationale: string;
}

// A candidate card scored against the current deck.
export interface SynergySuggestion {
  card: CardSummary;
  // Keywords this card shares with at least one card in the deck.
  sharedKeywords: string[];
  // Tier source (theme overrides keyword when themes were computed):
  //   - Theme: gold = STRONG (closes-the-loop) match; silver = MODERATE
  //     in 2+ themes; bronze = MODERATE in 1 / WEAK-only.
  //   - Keyword fallback: gold = matches deck's #1 kw, etc.
  tier: Tier | null;
  // For in-tier ordering and for the count badge in the sidebar.
  shareCount: number;
  // One-line "why this card was recommended". Empty when theme
  // scoring didn't run.
  rationale?: string;
  // Each deck theme this candidate touches, populated when scoring
  // runs with the deck's themes.
  themeMatches?: CandidateThemeMatch[];
}

// A deck-card scored for "should you cut this?". Cards matching 0 of
// the deck's primary themes rise to the top.
export interface RemovalCandidate {
  card: CardSummary;
  themesMatched: number;
  matchedLabels: string[];
}
