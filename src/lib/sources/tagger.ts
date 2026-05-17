// Scryfall Tagger source adapter — stub.
//
// Scryfall's Tagger project (https://tagger.scryfall.com/) maintains a
// community-curated oracle-tag taxonomy that's by far the highest-value
// next addition to our keyword extraction:
//
//   - otag:ramp, otag:removal, otag:card-advantage, otag:tutor,
//     synergy-token, synergy-scry, synergy-graveyard, etc.
//
// Tags are queryable via Scryfall's `otag:` search operator:
//
//   https://api.scryfall.com/cards/search?q=otag%3Aramp
//
// To attach tags per card we have two viable strategies:
//   A) Ingest the entire Tagger graph once (heavy — many tag→card edges)
//      and store per-card tag arrays alongside the bulk data.
//   B) Reverse: per-card, search Scryfall for the tags that include it.
//      Cheaper per card but slow for whole-corpus ingest.
//
// Plan: implement strategy A as part of the bulk ingest, not in this
// per-card fetcher. This adapter exists so the aggregator's shape is
// stable; when ingest exposes tags, we'll either:
//   1) read from the same SQLite Card row's oracleTagsJson column, or
//   2) keep the source out of the per-card fetch path entirely.
//
// Until then, this stub returns null.

import type { CardSource, SourceCard } from "./types";

export const taggerSource: CardSource = {
  name: "tagger",
  priority: 40,
  async fetchByName(_name: string): Promise<SourceCard | null> {
    // TODO(tagger): once bulk ingest writes oracleTagsJson per card, this
    // adapter can be retired in favor of reading from the DB directly.
    return null;
  },
};
