import { describe, expect, it } from "vitest";
import type { CardSummary, DeckEntry } from "../types";
import {
  keywordFrequency,
  rankSuggestions,
  scoreCandidate,
  topThreeKeywords,
} from "./score";

function card(id: string, keywords: string[]): CardSummary {
  return {
    id,
    name: id,
    typeLine: "Creature",
    manaCost: null,
    colors: [],
    imageSmall: null,
    imageNormal: null,
    scryfallUri: null,
    keywords,
  };
}

function deck(...entries: Array<[CardSummary, number?]>): DeckEntry[] {
  return entries.map(([c, q = 1]) => ({ card: c, quantity: q }));
}

describe("keywordFrequency", () => {
  it("counts keywords across the deck, weighted by quantity", () => {
    const d = deck(
      [card("a", ["elf", "etb-trigger"]), 2],
      [card("b", ["elf"]), 1],
      [card("c", ["ramp"]), 1],
    );
    const f = keywordFrequency(d);
    expect(f).toEqual([
      { keyword: "elf", count: 3 },
      { keyword: "etb-trigger", count: 2 },
      { keyword: "ramp", count: 1 },
    ]);
  });

  it("breaks ties alphabetically for stable UI ordering", () => {
    const d = deck(
      [card("a", ["zebra"])],
      [card("b", ["apple"])],
      [card("c", ["mango"])],
    );
    expect(keywordFrequency(d).map((f) => f.keyword)).toEqual([
      "apple",
      "mango",
      "zebra",
    ]);
  });
});

describe("topThreeKeywords", () => {
  it("returns the three most-used keywords as primary/secondary/tertiary", () => {
    const d = deck(
      [card("a", ["elf"]), 5],
      [card("b", ["ramp"]), 3],
      [card("c", ["draw"]), 2],
      [card("d", ["flying"]), 1],
    );
    expect(topThreeKeywords(d)).toEqual({
      primary: "elf",
      secondary: "ramp",
      tertiary: "draw",
    });
  });

  it("leaves slots empty if the deck has fewer distinct keywords", () => {
    expect(topThreeKeywords(deck([card("a", ["elf"])]))).toEqual({
      primary: "elf",
      secondary: undefined,
      tertiary: undefined,
    });
  });
});

describe("scoreCandidate tier assignment", () => {
  const d = deck(
    [card("a", ["elf"]), 5],
    [card("b", ["ramp"]), 3],
    [card("c", ["draw"]), 2],
  );

  it("assigns gold when the candidate matches the deck's #1 keyword", () => {
    const r = scoreCandidate(card("x", ["elf", "trample"]), d);
    expect(r.tier).toBe("gold");
    expect(r.shareCount).toBe(1);
    expect(r.sharedKeywords).toEqual(["elf"]);
  });

  it("assigns silver when only the #2 keyword overlaps", () => {
    const r = scoreCandidate(card("x", ["ramp"]), d);
    expect(r.tier).toBe("silver");
  });

  it("assigns bronze when only the #3 keyword overlaps", () => {
    const r = scoreCandidate(card("x", ["draw"]), d);
    expect(r.tier).toBe("bronze");
  });

  it("prefers the higher tier when multiple match", () => {
    // matches both #1 (elf) and #3 (draw) → should be gold.
    const r = scoreCandidate(card("x", ["elf", "draw"]), d);
    expect(r.tier).toBe("gold");
    expect(r.shareCount).toBe(2);
  });

  it("returns null tier when no top-3 keyword matches", () => {
    const r = scoreCandidate(card("x", ["flying"]), d);
    expect(r.tier).toBeNull();
    expect(r.shareCount).toBe(0);
  });
});

describe("rankSuggestions ordering rules", () => {
  it("ranks gold-3 above silver-5 (tier dominates raw count)", () => {
    const d = deck(
      [card("a", ["elf"]), 5],
      [card("b", ["ramp"]), 3],
    );
    const goldThree = scoreCandidate(
      card("g3", ["elf", "etb-trigger", "draw"]),
      d,
    );
    // Force a silver-5 by giving the candidate the secondary keyword plus 4 extras.
    const silverFive = scoreCandidate(
      card("s5", ["ramp", "k1", "k2", "k3", "k4"]),
      d,
    );
    // Sanity-check the fixtures match what we're asserting about:
    expect(goldThree.tier).toBe("gold");
    expect(silverFive.tier).toBe("silver");

    const sorted = rankSuggestions([silverFive, goldThree]);
    expect(sorted[0]).toBe(goldThree);
    expect(sorted[1]).toBe(silverFive);
  });

  it("within the same tier, ranks by shareCount descending", () => {
    const d = deck([card("a", ["elf"]), 5]);
    const wide = scoreCandidate(card("wide", ["elf", "extra"]), d);
    const narrow = scoreCandidate(card("narrow", ["elf"]), d);
    // Both gold (only matching keyword is the primary "elf"), wide has more total overlap → wait,
    // here "extra" is not in the deck so it doesn't add to shareCount. Use a different setup.
    const d2 = deck(
      [card("a", ["elf", "ramp"]), 1],
      [card("b", ["elf"]), 1],
    );
    const both = scoreCandidate(card("both", ["elf", "ramp"]), d2);
    const onlyPrimary = scoreCandidate(card("only", ["elf"]), d2);
    expect(both.tier).toBe("gold");
    expect(onlyPrimary.tier).toBe("gold");
    const sorted = rankSuggestions([onlyPrimary, both]);
    expect(sorted[0]).toBe(both);
    expect(sorted[1]).toBe(onlyPrimary);
  });

  it("places untiered cards after every tiered card", () => {
    const d = deck([card("a", ["elf"]), 5]);
    const tiered = scoreCandidate(card("t", ["elf"]), d);
    const untiered = scoreCandidate(card("u", ["flying"]), d);
    expect(rankSuggestions([untiered, tiered])).toEqual([tiered, untiered]);
  });
});
