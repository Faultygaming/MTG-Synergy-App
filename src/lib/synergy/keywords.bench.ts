// Benchmarks for the keyword-extraction hot path.
//
// `extractKeywords` runs once per card during ingest (~30k cards for the
// full Scryfall corpus) and once per card on demand for any card resolved
// via the paste API. Optimizing this function pays off twice.
//
// Run: `pnpm vitest bench src/lib/synergy/keywords.bench.ts`

import { bench, describe } from "vitest";
import { extractKeywords, normalizeKeyword, subtypesFromTypeLine } from "./keywords";

// A handful of realistic Scryfall card shapes covering the regex pack's
// hot patterns (etb-trigger, draw, ramp, token-maker, +1/+1 counters).
const SAMPLES = [
  {
    keywords: ["Flying"],
    type_line: "Creature — Elemental",
    oracle_text:
      "Flying. When Mulldrifter enters the battlefield, draw two cards. Evoke {2}{U}",
    produced_mana: [],
  },
  {
    keywords: [],
    type_line: "Legendary Creature — Elf Druid",
    oracle_text:
      "Other Elf creatures you control get +1/+1. {T}: Add an amount of {G} equal to the number of Elves you control.",
    produced_mana: ["G"],
  },
  {
    keywords: [],
    type_line: "Sorcery",
    oracle_text:
      "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
    produced_mana: [],
  },
  {
    keywords: ["Haste", "Trample"],
    type_line: "Creature — Beast",
    oracle_text:
      "When Craterhoof Behemoth enters the battlefield, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.",
    produced_mana: [],
  },
  {
    keywords: [],
    type_line: "Artifact",
    oracle_text: "{T}: Add {C}{C}.",
    produced_mana: ["C"],
  },
];

// A synthetic Scryfall card with maximally pessimistic input for the
// regex pack — long oracle text full of regex-triggering substrings.
const HEAVY = {
  keywords: ["Flying", "Haste", "Trample", "Vigilance", "Lifelink"],
  type_line: "Legendary Creature — Human Wizard Cleric",
  oracle_text: [
    "When this creature enters the battlefield, draw two cards.",
    "Whenever this creature attacks, create a 1/1 token.",
    "Whenever you cast a spell, target opponent discards a card.",
    "Search your library for a basic land card.",
    "Destroy target creature.",
    "Sacrifice a creature: gain 3 life.",
    "Return target card from your graveyard to your hand.",
    "+1/+1 counter. Proliferate. Take an extra turn after this one.",
  ].join(" "),
  produced_mana: ["W", "U", "B", "R", "G"],
};

const FIFTY = Array.from({ length: 50 }, () =>
  SAMPLES[Math.floor(Math.random() * SAMPLES.length)],
);

describe("normalizeKeyword", () => {
  bench("simple lower-kebab", () => {
    normalizeKeyword("Enters The Battlefield");
  });
});

describe("subtypesFromTypeLine", () => {
  bench("with subtypes", () => {
    subtypesFromTypeLine("Legendary Creature — Human Wizard Cleric");
  });
  bench("no subtypes", () => {
    subtypesFromTypeLine("Sorcery");
  });
});

describe("extractKeywords", () => {
  bench("light card (5 keywords avg)", () => {
    extractKeywords(SAMPLES[0]);
  });

  bench("medium card (Cultivate-like)", () => {
    extractKeywords(SAMPLES[2]);
  });

  bench("heavy card (worst-case regex pack)", () => {
    extractKeywords(HEAVY);
  });

  bench("with oracle tags unioned in", () => {
    extractKeywords(SAMPLES[1], [
      "ramp",
      "mana-dork",
      "card-advantage",
      "lord",
      "anthem",
    ]);
  });

  bench("50-card batch (simulates ingest of one set)", () => {
    for (const c of FIFTY) extractKeywords(c);
  });
});
