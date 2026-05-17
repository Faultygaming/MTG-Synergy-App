import { describe, expect, it } from "vitest";
import {
  colorIdentityUnion,
  isCandidateLegal,
  validateCommanderDeck,
} from "./rules";
import type { CommanderLegalityCard } from "./rules";

function c(
  name: string,
  typeLine: string,
  colorIdentity: string[] = [],
  oracleText = "",
): CommanderLegalityCard {
  return {
    id: name,
    name,
    typeLine,
    manaCost: null,
    colors: [],
    imageSmall: null,
    imageNormal: null,
    scryfallUri: null,
    keywords: [],
    colorIdentity,
    oracleText,
  };
}

function ninetyNineOf(card: CommanderLegalityCard) {
  // 99 distinct copies via a name suffix, so we don't trip the singleton rule.
  return Array.from({ length: 99 }, (_, i) => ({
    card: { ...card, name: `${card.name} #${i}`, id: `${card.id}-${i}` },
    quantity: 1,
  }));
}

describe("colorIdentityUnion", () => {
  it("unions and sorts color identities", () => {
    expect(
      colorIdentityUnion([
        c("A", "Legendary Creature — Elf", ["G"]),
        c("B", "Legendary Creature — Bird", ["W", "U"]),
      ]),
    ).toEqual(["G", "U", "W"]);
  });
});

describe("validateCommanderDeck", () => {
  const goodCommander = c("World Shaper", "Legendary Creature — Elf Druid", ["G"]);
  const buildBasicGoodDeck = () => ({
    commanders: [goodCommander],
    cards: ninetyNineOf(c("Forest", "Basic Land — Forest", ["G"])),
  });

  it("accepts a 1-commander + 99-card mono-green deck with basics", () => {
    expect(validateCommanderDeck(buildBasicGoodDeck())).toEqual([]);
  });

  it("rejects a deck with the wrong total card count", () => {
    const d = buildBasicGoodDeck();
    d.cards.pop();
    const v = validateCommanderDeck(d);
    expect(v).toContainEqual({ kind: "deck-size", expected: 100, actual: 99 });
  });

  it("rejects a non-legendary commander", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [c("Llanowar Elves", "Creature — Elf Druid", ["G"])];
    const v = validateCommanderDeck(d);
    expect(v).toContainEqual({
      kind: "illegal-commander",
      cardName: "Llanowar Elves",
      reason: "not-legendary",
    });
  });

  it("accepts a legendary planeswalker that can be your commander", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [
      c(
        "Freyalise, Llanowar's Fury",
        "Legendary Planeswalker — Freyalise",
        ["G"],
        "Freyalise, Llanowar's Fury can be your commander.",
      ),
    ];
    expect(validateCommanderDeck(d).filter((v) => v.kind === "illegal-commander")).toEqual([]);
  });

  it("accepts a legendary spacecraft as commander (e.g. Hearthhull)", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [
      c(
        "Hearthhull, the Worldseed",
        "Legendary Artifact — Spacecraft",
        ["B", "R", "G"],
      ),
    ];
    // CI of the deck won't match (basics are mono-green); we only check
    // commander-eligibility here, not the CI cascade.
    const v = validateCommanderDeck(d).filter((x) => x.kind === "illegal-commander");
    expect(v).toEqual([]);
  });

  it("accepts a legendary vehicle as commander", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [
      c("Heart of Kiran", "Legendary Artifact — Vehicle", []),
    ];
    const v = validateCommanderDeck(d).filter((x) => x.kind === "illegal-commander");
    expect(v).toEqual([]);
  });

  it("rejects a non-legendary spacecraft", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [c("Some Ship", "Artifact — Spacecraft", [])];
    const v = validateCommanderDeck(d);
    expect(v).toContainEqual({
      kind: "illegal-commander",
      cardName: "Some Ship",
      reason: "not-legendary",
    });
  });

  it("rejects a legendary planeswalker without commander-eligible text", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [
      c("Jace, the Mind Sculptor", "Legendary Planeswalker — Jace", ["U"]),
    ];
    const v = validateCommanderDeck(d);
    expect(v).toContainEqual({
      kind: "illegal-commander",
      cardName: "Jace, the Mind Sculptor",
      reason: "not-creature-or-eligible-pw",
    });
  });

  it("rejects cards outside the commander's color identity", () => {
    const d = buildBasicGoodDeck();
    d.cards[0] = {
      card: c("Lightning Bolt", "Instant", ["R"]),
      quantity: 1,
    };
    const v = validateCommanderDeck(d);
    expect(v).toContainEqual({
      kind: "color-identity",
      cardName: "Lightning Bolt",
      cardCi: ["R"],
      commanderCi: ["G"],
    });
  });

  it("rejects multiple copies of non-basic cards (singleton)", () => {
    const d = buildBasicGoodDeck();
    d.cards[0] = {
      card: c("Cultivate", "Sorcery", ["G"]),
      quantity: 2,
    };
    // Deck size will also be off by 1; we only assert on the singleton check.
    const v = validateCommanderDeck(d);
    expect(v).toContainEqual({
      kind: "singleton",
      cardName: "Cultivate",
      quantity: 2,
    });
  });

  it("allows multiple basics", () => {
    const d = buildBasicGoodDeck();
    d.cards = [{ card: c("Forest", "Basic Land — Forest", ["G"]), quantity: 99 }];
    const v = validateCommanderDeck(d).filter((x) => x.kind === "singleton");
    expect(v).toEqual([]);
  });

  it("allows the canonical 'any number of' exceptions", () => {
    const d = buildBasicGoodDeck();
    d.cards[0] = {
      card: c("Relentless Rats", "Creature — Rat", ["B"]),
      quantity: 7,
    };
    // CI will fail (we're mono-G); we're only asserting singleton compliance.
    const v = validateCommanderDeck(d).filter((x) => x.kind === "singleton");
    expect(v).toEqual([]);
  });

  it("rejects banned cards", () => {
    const d = buildBasicGoodDeck();
    d.cards[0] = { card: c("Sol Ring", "Artifact"), quantity: 1 };
    // Sol Ring is NOT banned — sanity check our list is real.
    expect(validateCommanderDeck(d).filter((x) => x.kind === "banned")).toEqual([]);
    d.cards[0] = { card: c("Black Lotus", "Artifact"), quantity: 1 };
    expect(validateCommanderDeck(d)).toContainEqual({
      kind: "banned",
      cardName: "Black Lotus",
    });
  });
});

describe("isCandidateLegal", () => {
  const cmd = c("World Shaper", "Legendary Creature — Elf Druid", ["G"]);
  it("accepts a candidate that fits the commander's color identity", () => {
    expect(isCandidateLegal(c("Cultivate", "Sorcery", ["G"]), [cmd])).toBe(true);
  });
  it("rejects a candidate with extra colors", () => {
    expect(isCandidateLegal(c("Lightning Bolt", "Instant", ["R"]), [cmd])).toBe(false);
  });
  it("rejects banned cards regardless of color", () => {
    expect(isCandidateLegal(c("Black Lotus", "Artifact", []), [cmd])).toBe(false);
  });
});
