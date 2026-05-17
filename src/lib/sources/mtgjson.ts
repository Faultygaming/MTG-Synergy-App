// MTGJSON source adapter — stub.
//
// MTGJSON publishes the AtomicCards.json bulk file
// (https://mtgjson.com/api/v5/AtomicCards.json) keyed by card name. We
// want the `edhrecRank`, `leadershipSkills`, and ruling provenance fields
// that Scryfall doesn't directly expose.
//
// Implementation plan:
//   1. scripts/ingest-mtgjson.ts downloads AtomicCards.json once and writes
//      a slim index to data/mtgjson-atomic.json (one row per card name).
//   2. This adapter reads from that local index — no per-card HTTP.
//   3. Fall through to null if the index file isn't present (yet).
//
// Until ingest is implemented, this stub returns null and the aggregator
// happily uses only Scryfall.

import type { CardSource, SourceCard } from "./types";

export const mtgjsonSource: CardSource = {
  name: "mtgjson",
  priority: 20,
  async fetchByName(_name: string): Promise<SourceCard | null> {
    // TODO(mtgjson): load data/mtgjson-atomic.json on first call (lazy
    // singleton), look up by canonical English name, return the slice we
    // care about. See src/lib/sources/types.ts SourceCard for the shape.
    return null;
  },
};
