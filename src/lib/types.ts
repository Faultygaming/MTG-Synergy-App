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

// A candidate card scored against the current deck.
export interface SynergySuggestion {
  card: CardSummary;
  // Keywords this card shares with at least one card in the deck.
  sharedKeywords: string[];
  // Tier is determined by which of the deck's top-N keywords this candidate matches.
  // gold = matches the deck's #1 keyword; silver = #2; bronze = #3.
  // null = no overlap with the deck's primary/secondary/tertiary keywords.
  tier: Tier | null;
  // For in-tier ordering and for the "3" badge in the sidebar.
  shareCount: number;
}
