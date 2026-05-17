// EDHREC source adapter — stub.
//
// EDHREC has no official API but exposes unofficial JSON endpoints that
// power the website (and which pyedhrec wraps). The endpoint shape that
// matters for synergy is:
//
//   https://json.edhrec.com/pages/cards/<slug>.json
//
// where <slug> is a lowercased-hyphenated card name. The response includes
// the card's inclusion rate and the new "lift" co-occurrence statistic
// described at:
//   https://edhrec.com/articles/from-synergy-to-lift-the-math-behind-edhrecs-new-era
//
// We will use lift to boost the synergy score for cards that empirically
// appear together in commander decks beyond what their keyword overlap
// would predict — a v2 enrichment, not a v1 hard requirement.
//
// Caveats before turning this on:
//   - EDHREC ToS isn't explicit about third-party JSON consumption. Cache
//     aggressively (per-card, with a TTL) and attribute prominently.
//   - The endpoint is rate-limited; respect it (~1 req/sec).
//
// Until both of those are resolved, this stub returns null.

import type { CardSource, SourceCard } from "./types";

export const edhrecSource: CardSource = {
  name: "edhrec",
  priority: 30,
  async fetchByName(_name: string): Promise<SourceCard | null> {
    // TODO(edhrec): implement json.edhrec.com/pages/cards/<slug>.json with
    // local cache. Populate SourceCard.edhrecSynergy with the lift value
    // and SourceCard.edhrecRank with the overall popularity rank.
    return null;
  },
};
