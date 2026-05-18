import { describe, expect, it } from "vitest";
import {
  COMMON_KEYWORD_STOPLIST,
  FILLER_TRIBE_STOPLIST,
  buildExcludeSet,
} from "./stoplist";
import { keywordFrequency, topThreeKeywords } from "./score";
import type { CardSummary, DeckEntry } from "../types";
import { buildMapElements } from "./map";

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

describe("COMMON_KEYWORD_STOPLIST", () => {
  it("contains the headline noise tokens called out by the user", () => {
    for (const k of ["creature", "land", "produces-g", "legendary", "instant"]) {
      expect(COMMON_KEYWORD_STOPLIST.has(k)).toBe(true);
    }
  });

  it("does NOT include real synergy themes", () => {
    for (const k of [
      "ramp",
      "etb-trigger",
      "landfall",
      "graveyard-recursion",
      "+1-+1-counters",
      "elf",
      "goblin",
      "dragon",
      "produces-x",
      "otag:landfall",
    ]) {
      expect(COMMON_KEYWORD_STOPLIST.has(k)).toBe(false);
    }
  });

  it("filler tribes are separate from the common stoplist", () => {
    expect(COMMON_KEYWORD_STOPLIST.has("human")).toBe(false);
    expect(FILLER_TRIBE_STOPLIST.has("human")).toBe(true);
  });
});

describe("buildExcludeSet", () => {
  it("defaults to applying both common stoplist and filler tribes", () => {
    const s = buildExcludeSet();
    expect(s.has("creature")).toBe(true);
    expect(s.has("human")).toBe(true);
  });

  it("can disable just the common stoplist", () => {
    const s = buildExcludeSet({ applyCommon: false });
    expect(s.has("creature")).toBe(false);
    expect(s.has("human")).toBe(true);
  });

  it("can disable just the tribal stoplist", () => {
    const s = buildExcludeSet({ applyTribes: false });
    expect(s.has("creature")).toBe(true);
    expect(s.has("human")).toBe(false);
  });
});

describe("keywordFrequency with stoplist", () => {
  it("drops excluded keywords from the count", () => {
    const d = deck(
      [card("a", ["creature", "elf", "ramp"])],
      [card("b", ["creature", "elf", "ramp"])],
      [card("c", ["creature", "ramp"])],
    );
    const freqs = keywordFrequency(d, COMMON_KEYWORD_STOPLIST);
    const names = freqs.map((f) => f.keyword);
    expect(names).not.toContain("creature");
    expect(names).toContain("ramp");
    expect(names).toContain("elf");
  });
});

describe("topThreeKeywords with stoplist", () => {
  it("promotes real themes when stoplist is applied", () => {
    // Without stoplist: creature dominates. With it: ramp wins.
    const d = deck(
      [card("a", ["creature", "ramp"])],
      [card("b", ["creature", "ramp"])],
      [card("c", ["creature", "etb-trigger"])],
    );
    const top = topThreeKeywords(d, COMMON_KEYWORD_STOPLIST);
    expect(top.primary).toBe("ramp");
  });

  it("falls back to 'creature' if stoplist is empty", () => {
    const d = deck(
      [card("a", ["creature", "ramp"])],
      [card("b", ["creature"])],
      [card("c", ["creature"])],
    );
    const top = topThreeKeywords(d);
    expect(top.primary).toBe("creature");
  });
});

describe("buildMapElements minClusterSize edge filter", () => {
  function entries(...kw: string[][]): { id: string; name: string; keywords: string[] }[] {
    return kw.map((k, i) => ({ id: `c${i}`, name: `c${i}`, keywords: k }));
  }

  it("drops tier-4 edges whose underlying keyword is shared by only 2 cards", () => {
    const cards = entries(
      ["land", "scion"],
      ["land", "scion"], // these two share 'scion' but no other card has it
      ["land", "ramp"],
      ["land", "ramp"],
      ["land", "ramp"],
    );
    const top = { primary: "land" };
    const { edges } = buildMapElements(cards, top, {
      includeTier4: true,
      minClusterSize: 3,
    });
    // No tier-4 edge should connect c0 ↔ c1 (their only shared non-top
    // keyword 'scion' has count 2 < threshold 3).
    const pairEdges = edges.filter(
      (e) =>
        (e.source === "c0" && e.target === "c1") ||
        (e.source === "c1" && e.target === "c0"),
    );
    expect(pairEdges.every((e) => e.tier !== 4)).toBe(true);
  });

  it("keeps tier-4 edges when the underlying keyword forms a real cluster (≥3 cards)", () => {
    const cards = entries(
      ["ramp", "untiered-1"],
      ["ramp", "untiered-1"],
      ["ramp", "untiered-1"],
    );
    const top = { primary: "primary-not-present" }; // none of these are tier 1
    const { edges } = buildMapElements(cards, top, {
      includeTier4: true,
      minClusterSize: 3,
    });
    // Three cards × three pairs = 3 edges
    expect(edges).toHaveLength(3);
    expect(edges.every((e) => e.tier === 4)).toBe(true);
  });

  it("does not drop tier-1/2/3 edges based on minClusterSize", () => {
    const cards = entries(["land"], ["land"]);
    const top = { primary: "land" };
    const { edges } = buildMapElements(cards, top, {
      includeTier4: false,
      minClusterSize: 99,
    });
    expect(edges).toHaveLength(1);
    expect(edges[0].tier).toBe(1);
  });
});
