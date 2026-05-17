// Aggregator tests use the public `resolveCard` indirectly through the
// individual source modules — but since 3 of the 4 sources are stubs,
// the easiest tests inject a fake source. We do that by re-implementing
// the merge logic locally (the public function uses the module-level
// registry which isn't injectable yet — see TODO in aggregator.ts to
// make it injectable). For now, we test the merge helper expectations
// through a parallel-shape mini implementation.
//
// When the registry becomes injectable, replace these tests with ones
// that drive resolveCard() against fake CardSource instances.

import { describe, expect, it } from "vitest";
import type { SourceCard } from "./types";

// Mirrors the merge contract documented in aggregator.ts. If you change
// the policy there, change it here too — this test is the spec.
function mergeForTest(hits: SourceCard[]) {
  const first = <K extends keyof SourceCard>(k: K) =>
    hits.find((h) => h[k] !== undefined && h[k] !== "")?.[k];
  const union = <K extends "printedKeywords" | "oracleTags">(k: K): string[] => {
    const set = new Set<string>();
    for (const h of hits) for (const x of (h[k] ?? []) as string[]) set.add(x);
    return Array.from(set);
  };
  return {
    name: first("name") ?? "",
    typeLine: first("typeLine") ?? "",
    oracleText: first("oracleText"),
    printedKeywords: union("printedKeywords"),
    oracleTags: union("oracleTags"),
    sources: hits.map((h) => h.source),
  };
}

describe("aggregator merge policy", () => {
  it("first-non-empty wins for core fields", () => {
    const merged = mergeForTest([
      { source: "scryfall", name: "Llanowar Elves", typeLine: "Creature — Elf Druid", oracleText: "{T}: Add {G}." },
      { source: "mtgjson", name: "Llanowar Elves", typeLine: "Creature — Elf Druid", oracleText: "DIFFERENT TEXT" },
    ]);
    expect(merged.oracleText).toBe("{T}: Add {G}.");
  });

  it("array fields union across sources", () => {
    const merged = mergeForTest([
      { source: "scryfall", name: "X", typeLine: "Creature", printedKeywords: ["Flying"], oracleTags: [] },
      { source: "tagger", name: "X", typeLine: "Creature", printedKeywords: [], oracleTags: ["otag:evasion", "otag:flier"] },
    ]);
    expect(merged.printedKeywords).toContain("Flying");
    expect(merged.oracleTags).toEqual(expect.arrayContaining(["otag:evasion", "otag:flier"]));
  });

  it("sources list reflects which adapters contributed", () => {
    const merged = mergeForTest([
      { source: "scryfall", name: "X", typeLine: "Creature" },
      { source: "mtgjson", name: "X", typeLine: "Creature" },
    ]);
    expect(merged.sources).toEqual(["scryfall", "mtgjson"]);
  });
});
