import { describe, expect, it } from "vitest";
import {
  detectDeckThemes,
  scoreCandidateByThemes,
  scoreDeckCardsForRemoval,
  themeTier,
  THEMES,
} from "./themes";
import type { CardSummary, DeckEntry } from "../types";

function card(name: string, keywords: string[]): CardSummary {
  return {
    id: name.toLowerCase().replace(/\s/g, "-"),
    name,
    typeLine: "Card",
    colors: [],
    keywords,
  };
}

function entry(name: string, keywords: string[], quantity = 1): DeckEntry {
  return { card: card(name, keywords), quantity };
}

describe("THEMES catalog", () => {
  it("has stable, unique ids", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every member has a known role", () => {
    for (const t of THEMES) {
      for (const m of t.members) {
        expect(["enabler", "payoff", "neutral"]).toContain(m.role);
      }
    }
  });
});

describe("detectDeckThemes", () => {
  it("surfaces a primary theme once it has 5+ contributing cards", () => {
    const deck: DeckEntry[] = [
      entry("Crucible of Worlds", ["land-recursion"]),
      entry("Aftermath Analyst", ["land-recursion", "death-trigger"]),
      entry("Splendid Reclamation", ["land-recursion"]),
      entry("Life from the Loam", ["land-recursion"]),
      entry("Ramunap Excavator", ["land-recursion"]),
      entry("Cultivate", ["ramp"]),
      entry("Lightning Bolt", ["damage-removal"]),
    ];
    const themes = detectDeckThemes(deck);
    const lands = themes.find((t) => t.themeId === "lands-matter");
    expect(lands).toBeDefined();
    expect(lands!.payoffCount).toBeGreaterThanOrEqual(5); // 5 land-recursion cards
    expect(lands!.enablerCount).toBeGreaterThanOrEqual(1); // Cultivate
  });

  it("filters out themes below the threshold", () => {
    const deck: DeckEntry[] = [
      entry("Reanimate", ["reanimator"]),
      entry("Lightning Bolt", ["damage-removal"]),
    ];
    const themes = detectDeckThemes(deck);
    // Neither theme has 5+ cards; only deeply-touched themes survive.
    expect(themes.length).toBe(0);
  });

  it("multi-role cards count toward each role they satisfy", () => {
    // Mazirek-style: sacrifice-outlet (enabler) + +1/+1-counters (neutral)
    // in two different themes.
    const deck: DeckEntry[] = [
      entry("Card A", ["sacrifice-outlet", "death-trigger"]),
      entry("Card B", ["sacrifice-outlet", "death-trigger"]),
      entry("Card C", ["sacrifice-outlet", "death-trigger"]),
      entry("Card D", ["sacrifice-outlet", "death-trigger"]),
      entry("Card E", ["sacrifice-outlet", "death-trigger"]),
    ];
    const themes = detectDeckThemes(deck);
    const aristocrats = themes.find((t) => t.themeId === "aristocrats");
    expect(aristocrats).toBeDefined();
    expect(aristocrats!.enablerCount).toBe(5);
    expect(aristocrats!.payoffCount).toBe(5);
  });
});

describe("scoreCandidateByThemes", () => {
  // The Crucible scenario the whole refactor was triggered by: deck has
  // 8 enablers of graveyard-lands but only 1-2 payoffs. Crucible (payoff)
  // should be flagged "strong" with rationale referring to the imbalance.
  it("flags Crucible as STRONG when deck has many enablers but few payoffs", () => {
    const deck: DeckEntry[] = [
      // 6 enablers (extra-land-drops, land-sacrifice, ramp)
      entry("Cultivate", ["ramp"]),
      entry("Kodama's Reach", ["ramp"]),
      entry("Harrow", ["ramp", "land-sacrifice"]),
      entry("Roiling Regrowth", ["ramp", "land-sacrifice"]),
      entry("Exploration", ["extra-land-drops"]),
      entry("Oracle of Mul Daya", ["extra-land-drops"]),
      // 1 payoff (landfall)
      entry("Tireless Tracker", ["landfall"]),
    ];
    const deckThemes = detectDeckThemes(deck);
    const lands = deckThemes.find((t) => t.themeId === "lands-matter");
    expect(lands).toBeDefined();
    expect(lands!.enablerCount).toBeGreaterThanOrEqual(5);
    expect(lands!.payoffCount).toBeLessThan(3);

    const crucible = card("Crucible of Worlds", ["land-recursion"]);
    const matches = scoreCandidateByThemes(crucible, deckThemes);
    const landsMatch = matches.find((m) => m.themeId === "lands-matter");
    expect(landsMatch).toBeDefined();
    expect(landsMatch!.cardRole).toBe("payoff");
    expect(landsMatch!.signal).toBe("strong");
    expect(landsMatch!.rationale).toMatch(/enabler/i);
    expect(landsMatch!.rationale).toMatch(/closes? the loop/i);
  });

  it("ranks payoff > enabler > neutral when a card touches multiple roles", () => {
    const deck: DeckEntry[] = [
      entry("Aftermath Analyst", ["land-recursion"]),
      entry("Cultivate", ["ramp"]),
      entry("Harrow", ["ramp"]),
      entry("Kodama's Reach", ["ramp"]),
      entry("Tireless Tracker", ["landfall"]),
      entry("Lord Windgrace", ["landfall"]),
    ];
    const deckThemes = detectDeckThemes(deck);
    // Worldsoul's Rage style card with multiple roles in lands-matter
    const c = card("Multi-Role", ["land-recursion", "ramp"]);
    const matches = scoreCandidateByThemes(c, deckThemes);
    const lands = matches.find((m) => m.themeId === "lands-matter");
    expect(lands!.cardRole).toBe("payoff"); // payoff wins
  });

  it("returns empty array when card doesn't touch any deck theme", () => {
    const deck: DeckEntry[] = [
      entry("Cultivate", ["ramp"]),
      entry("Kodama's Reach", ["ramp"]),
      entry("Three Visits", ["ramp"]),
      entry("Nature's Lore", ["ramp"]),
      entry("Farseek", ["ramp"]),
    ];
    const deckThemes = detectDeckThemes(deck);
    const c = card("Counterspell", ["counterspell"]);
    const matches = scoreCandidateByThemes(c, deckThemes);
    // Stax / Control isn't a deck theme here.
    expect(matches.length).toBe(0);
  });
});

describe("themeTier", () => {
  it("returns gold on any STRONG match", () => {
    expect(
      themeTier([
        {
          themeId: "x",
          themeLabel: "X",
          cardRole: "payoff",
          signal: "strong",
          rationale: "",
        },
      ]),
    ).toBe("gold");
  });

  it("returns silver on 2+ MODERATE matches", () => {
    expect(
      themeTier([
        {
          themeId: "x",
          themeLabel: "X",
          cardRole: "payoff",
          signal: "moderate",
          rationale: "",
        },
        {
          themeId: "y",
          themeLabel: "Y",
          cardRole: "enabler",
          signal: "moderate",
          rationale: "",
        },
      ]),
    ).toBe("silver");
  });

  it("returns bronze on 1 moderate or only weak matches", () => {
    expect(
      themeTier([
        {
          themeId: "x",
          themeLabel: "X",
          cardRole: "payoff",
          signal: "moderate",
          rationale: "",
        },
      ]),
    ).toBe("bronze");
    expect(
      themeTier([
        {
          themeId: "x",
          themeLabel: "X",
          cardRole: "neutral",
          signal: "weak",
          rationale: "",
        },
      ]),
    ).toBe("bronze");
  });

  it("returns null on no matches", () => {
    expect(themeTier([])).toBeNull();
  });
});

describe("scoreDeckCardsForRemoval", () => {
  it("ranks cards with 0 theme matches at the top of the cut list", () => {
    const deck: DeckEntry[] = [
      // Lands-matter primary
      entry("Cultivate", ["ramp"]),
      entry("Kodama's Reach", ["ramp"]),
      entry("Tireless Tracker", ["landfall"]),
      entry("Crucible of Worlds", ["land-recursion"]),
      entry("Aftermath Analyst", ["land-recursion"]),
      // The odd one out — no theme membership
      entry("Vanilla Bear", ["bear", "creature"]),
    ];
    const deckThemes = detectDeckThemes(deck);
    const removals = scoreDeckCardsForRemoval(deck, deckThemes);
    expect(removals[0].card.name).toBe("Vanilla Bear");
    expect(removals[0].themesMatched).toBe(0);
    // The synergistic cards should rank lower (more themes matched).
    const cultivate = removals.find((r) => r.card.name === "Cultivate");
    expect(cultivate!.themesMatched).toBeGreaterThan(0);
  });
});
