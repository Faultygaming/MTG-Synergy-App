// Multi-source card data interfaces.
//
// The product needs to aggregate card data, images, and keywords from
// multiple authorities — no single source has everything:
//
//   - Scryfall:  best images, canonical fields, oracle tags via the Tagger.
//   - MTGJSON:   EDHREC rank, foreign names, ruling provenance.
//   - EDHREC:    "lift" / co-occurrence stats for synergy scoring.
//   - Tagger:    Scryfall oracle tags (otag:) — a community synergy taxonomy.
//
// Each source implements `CardSource`. The aggregator in ./aggregator.ts
// calls them in priority order and merges results into a `MergedCard`.

export interface SourceCard {
  source: string;                  // "scryfall" | "mtgjson" | "edhrec" | "tagger"
  // Core, available from most sources:
  id?: string;                     // source-local id
  name: string;
  typeLine?: string;
  oracleText?: string;
  manaCost?: string;
  cmc?: number;
  colors?: string[];
  colorIdentity?: string[];
  // Printed keyword abilities (the canonical Scryfall keywords[] flavor).
  printedKeywords?: string[];
  // Images.
  imageSmall?: string;
  imageNormal?: string;
  scryfallUri?: string;
  // Source-specific extras. The aggregator preserves these so downstream
  // code can opt into richer features without forcing every source to
  // implement them.
  edhrecRank?: number;             // MTGJSON or Scryfall
  oracleTags?: string[];           // Tagger
  edhrecSynergy?: number;          // EDHREC lift score (TODO: range / units)
}

export interface CardSource {
  name: SourceCard["source"];
  // Lower runs first. Defaults: scryfall=10, mtgjson=20, edhrec=30, tagger=40.
  priority: number;
  // Returns null if the source can't satisfy the lookup. Throw for hard
  // errors (5xx, network). Soft "not found" should be null.
  fetchByName(name: string): Promise<SourceCard | null>;
}

// The merged shape the rest of the app consumes. Required core fields are
// guaranteed because we never produce a `MergedCard` from sources that
// can't supply at least name + typeLine.
export interface MergedCard {
  name: string;
  typeLine: string;
  oracleText?: string;
  manaCost?: string;
  cmc?: number;
  colors: string[];
  colorIdentity: string[];
  printedKeywords: string[];
  imageSmall?: string;
  imageNormal?: string;
  scryfallUri?: string;
  edhrecRank?: number;
  oracleTags: string[];
  edhrecSynergy?: number;
  // Which sources contributed to this merged card; useful for debugging
  // "why isn't this card showing oracle tags?" type questions.
  sources: string[];
}
