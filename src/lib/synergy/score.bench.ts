// Benchmarks for the synergy-ranking hot path.
//
// `rankCandidates` runs on every deck page render against the candidate
// pool (currently capped at 2000 cards). It's the dominant CPU cost
// between the DB read and the React render, so optimizing it directly
// shortens TTFB on /deck/[id].
//
// Run: `pnpm vitest bench src/lib/synergy/score.bench.ts`

import { bench, describe } from "vitest";
import type { CardSummary, DeckEntry } from "../types";
import {
  keywordFrequency,
  rankCandidates,
  rankSuggestions,
  scoreCandidate,
  topThreeKeywords,
} from "./score";

// Realistic keyword pool drawn from the regex pack + common tribes/tags.
const KEYWORD_POOL = [
  "creature", "instant", "sorcery", "artifact", "enchantment", "land",
  "elf", "goblin", "human", "wizard", "warrior", "shaman", "druid",
  "etb-trigger", "death-trigger", "attack-trigger", "cast-trigger",
  "draw", "token-maker", "ramp", "mana-rock", "removal-targeted",
  "board-wipe", "counterspell", "lifegain", "sacrifice-outlet",
  "discard", "graveyard-recursion", "mill", "+1-+1-counters", "proliferate",
  "tutor", "blink", "extra-turn", "haste", "indestructible", "hexproof",
  "flying", "trample", "deathtouch", "lifelink", "vigilance", "menace",
  "produces-w", "produces-u", "produces-b", "produces-r", "produces-g",
  "otag:ramp", "otag:card-advantage", "otag:tutor", "otag:removal",
  "otag:landfall", "otag:graveyard-recursion", "otag:sacrifice-outlet",
];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 0x100000000;
    return s / 0x100000000;
  };
}

function fakeCard(id: string, keywordsPerCard: number, rand: () => number): CardSummary {
  const ks = new Set<string>();
  while (ks.size < keywordsPerCard) {
    ks.add(KEYWORD_POOL[Math.floor(rand() * KEYWORD_POOL.length)]);
  }
  return {
    id,
    name: id,
    typeLine: "Creature",
    manaCost: null,
    colors: [],
    imageSmall: null,
    imageNormal: null,
    scryfallUri: null,
    keywords: Array.from(ks),
  };
}

// Build once at module load so bench iterations only measure the
// function-under-test, not the fixture setup.
const r99 = rng(42);
const r2000 = rng(7);
const DECK_99: DeckEntry[] = Array.from({ length: 99 }, (_, i) => ({
  card: fakeCard(`d${i}`, 10, r99),
  quantity: 1,
}));
const POOL_2000: CardSummary[] = Array.from({ length: 2000 }, (_, i) =>
  fakeCard(`p${i}`, 10, r2000),
);
const POOL_500: CardSummary[] = POOL_2000.slice(0, 500);
const POOL_100: CardSummary[] = POOL_2000.slice(0, 100);

// Pre-scored suggestions for the rankSuggestions-only bench (isolates
// the sort step from the scoring step).
const SCORED_2000 = POOL_2000.map((c) => scoreCandidate(c, DECK_99));

describe("keywordFrequency", () => {
  bench("99-card deck", () => {
    keywordFrequency(DECK_99);
  });
});

describe("topThreeKeywords", () => {
  bench("99-card deck", () => {
    topThreeKeywords(DECK_99);
  });
});

describe("scoreCandidate", () => {
  const top = topThreeKeywords(DECK_99);
  bench("single candidate vs 99-card deck", () => {
    scoreCandidate(POOL_2000[0], DECK_99, top);
  });
});

describe("rankSuggestions (sort only)", () => {
  bench("2000 pre-scored suggestions", () => {
    rankSuggestions(SCORED_2000);
  });
});

describe("rankCandidates (full pipeline)", () => {
  bench("100 candidates", () => {
    rankCandidates(POOL_100, DECK_99);
  });

  bench("500 candidates", () => {
    rankCandidates(POOL_500, DECK_99);
  });

  bench("2000 candidates (current page-render budget)", () => {
    rankCandidates(POOL_2000, DECK_99);
  });
});
