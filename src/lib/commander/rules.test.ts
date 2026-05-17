import { describe, expect, it } from "vitest";
import {
  colorIdentityUnion,
  hasBlockingViolations,
  isCandidateLegal,
  validateCommanderDeck,
  DEFAULT_CONFIG,
  type CommanderLegalityCard,
  type CommanderRulesConfig,
} from "./rules";

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
  return Array.from({ length: 99 }, (_, i) => ({
    card: { ...card, name: `${card.name} #${i}`, id: `${card.id}-${i}` },
    quantity: 1,
  }));
}

const STRICT = DEFAULT_CONFIG;

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

describe("validateCommanderDeck (strict default)", () => {
  const goodCommander = c("World Shaper", "Legendary Creature — Elf Druid", ["G"]);
  const buildBasicGoodDeck = () => ({
    commanders: [goodCommander],
    cards: ninetyNineOf(c("Forest", "Basic Land — Forest", ["G"])),
  });

  it("accepts a 1-commander + 99-card mono-green deck with basics", () => {
    expect(validateCommanderDeck(buildBasicGoodDeck())).toEqual([]);
  });

  it("emits violations at severity 'block' by default", () => {
    const d = buildBasicGoodDeck();
    d.cards.pop();
    const v = validateCommanderDeck(d);
    expect(v).toContainEqual({
      kind: "deck-size",
      expected: 100,
      actual: 99,
      severity: "block",
    });
  });

  it("rejects a non-legendary commander", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [c("Llanowar Elves", "Creature — Elf Druid", ["G"])];
    expect(validateCommanderDeck(d)).toContainEqual({
      kind: "illegal-commander",
      cardName: "Llanowar Elves",
      reason: "not-legendary",
      severity: "block",
    });
  });

  it("accepts a legendary spacecraft as commander (Hearthhull)", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [
      c("Hearthhull, the Worldseed", "Legendary Artifact — Spacecraft", ["B", "R", "G"]),
    ];
    expect(
      validateCommanderDeck(d).filter((x) => x.kind === "illegal-commander"),
    ).toEqual([]);
  });

  it("accepts a legendary vehicle as commander", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [c("Heart of Kiran", "Legendary Artifact — Vehicle", [])];
    expect(
      validateCommanderDeck(d).filter((x) => x.kind === "illegal-commander"),
    ).toEqual([]);
  });

  it("rejects a non-legendary spacecraft", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [c("Some Ship", "Artifact — Spacecraft", [])];
    expect(validateCommanderDeck(d)).toContainEqual({
      kind: "illegal-commander",
      cardName: "Some Ship",
      reason: "not-legendary",
      severity: "block",
    });
  });

  it("accepts a commander-eligible planeswalker", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [
      c(
        "Freyalise, Llanowar's Fury",
        "Legendary Planeswalker — Freyalise",
        ["G"],
        "Freyalise, Llanowar's Fury can be your commander.",
      ),
    ];
    expect(
      validateCommanderDeck(d).filter((x) => x.kind === "illegal-commander"),
    ).toEqual([]);
  });

  it("rejects a legendary planeswalker without commander-eligible text", () => {
    const d = buildBasicGoodDeck();
    d.commanders = [c("Jace, the Mind Sculptor", "Legendary Planeswalker — Jace", ["U"])];
    expect(validateCommanderDeck(d)).toContainEqual({
      kind: "illegal-commander",
      cardName: "Jace, the Mind Sculptor",
      reason: "not-creature-or-eligible-pw",
      severity: "block",
    });
  });

  it("rejects cards outside the commander's color identity", () => {
    const d = buildBasicGoodDeck();
    d.cards[0] = { card: c("Lightning Bolt", "Instant", ["R"]), quantity: 1 };
    expect(validateCommanderDeck(d)).toContainEqual({
      kind: "color-identity",
      cardName: "Lightning Bolt",
      cardCi: ["R"],
      commanderCi: ["G"],
      severity: "block",
    });
  });

  it("rejects multiple copies of non-basic cards (singleton)", () => {
    const d = buildBasicGoodDeck();
    d.cards[0] = { card: c("Cultivate", "Sorcery", ["G"]), quantity: 2 };
    expect(validateCommanderDeck(d)).toContainEqual({
      kind: "singleton",
      cardName: "Cultivate",
      quantity: 2,
      severity: "block",
    });
  });

  it("allows multiple basics", () => {
    const d = buildBasicGoodDeck();
    d.cards = [{ card: c("Forest", "Basic Land — Forest", ["G"]), quantity: 99 }];
    expect(validateCommanderDeck(d).filter((x) => x.kind === "singleton")).toEqual([]);
  });

  it("allows the canonical 'any number of' exceptions", () => {
    const d = buildBasicGoodDeck();
    d.cards[0] = { card: c("Relentless Rats", "Creature — Rat", ["B"]), quantity: 7 };
    expect(validateCommanderDeck(d).filter((x) => x.kind === "singleton")).toEqual([]);
  });

  it("rejects banned cards", () => {
    const d = buildBasicGoodDeck();
    d.cards[0] = { card: c("Black Lotus", "Artifact"), quantity: 1 };
    expect(validateCommanderDeck(d)).toContainEqual({
      kind: "banned",
      cardName: "Black Lotus",
      severity: "block",
    });
  });
});

describe("per-rule severity toggles", () => {
  const goodCommander = c("World Shaper", "Legendary Creature — Elf Druid", ["G"]);
  const bad = (overrides: Partial<CommanderRulesConfig>): CommanderRulesConfig => ({
    ...DEFAULT_CONFIG,
    ...overrides,
  });

  // A deliberately-broken deck that violates 4 rules at once.
  const brokenDeck = () => ({
    commanders: [goodCommander],
    cards: [
      // Banned + outside CI + multiple copies all on one card → 3 violations.
      { card: c("Black Lotus", "Artifact", []), quantity: 2 },
      // Outside CI.
      { card: c("Lightning Bolt", "Instant", ["R"]), quantity: 1 },
      // Pad to keep the size-check assertion meaningful.
      ...ninetyNineOf(c("Forest", "Basic Land — Forest", ["G"])).slice(0, 96),
    ],
  });

  it("'off' suppresses violations of that rule entirely", () => {
    const v = validateCommanderDeck(
      brokenDeck(),
      bad({ banlist: "off" }),
    );
    expect(v.find((x) => x.kind === "banned")).toBeUndefined();
    // Other rules still emit.
    expect(v.find((x) => x.kind === "color-identity")).toBeDefined();
  });

  it("'warn' downgrades severity from block to warn", () => {
    const v = validateCommanderDeck(
      brokenDeck(),
      bad({ singleton: "warn" }),
    );
    const singleton = v.find((x) => x.kind === "singleton");
    expect(singleton?.severity).toBe("warn");
    // Other rules still block.
    const banned = v.find((x) => x.kind === "banned");
    expect(banned?.severity).toBe("block");
  });

  it("globalMode 'warn' downgrades every block to warn at once", () => {
    const v = validateCommanderDeck(
      brokenDeck(),
      bad({ globalMode: "warn" }),
    );
    // No blockers left.
    expect(v.every((x) => x.severity === "warn")).toBe(true);
    // But violations are still emitted.
    expect(v.length).toBeGreaterThan(0);
  });

  it("globalMode 'warn' respects 'off' (off stays off)", () => {
    const v = validateCommanderDeck(
      brokenDeck(),
      bad({ globalMode: "warn", banlist: "off" }),
    );
    expect(v.find((x) => x.kind === "banned")).toBeUndefined();
  });

  it("hasBlockingViolations reflects severity", () => {
    const v1 = validateCommanderDeck(brokenDeck(), DEFAULT_CONFIG);
    expect(hasBlockingViolations(v1)).toBe(true);
    const v2 = validateCommanderDeck(brokenDeck(), bad({ globalMode: "warn" }));
    expect(hasBlockingViolations(v2)).toBe(false);
  });
});

describe("isCandidateLegal", () => {
  const cmd = c("World Shaper", "Legendary Creature — Elf Druid", ["G"]);

  it("accepts a candidate that fits the commander's color identity (default config)", () => {
    expect(isCandidateLegal(c("Cultivate", "Sorcery", ["G"]), [cmd])).toBe(true);
  });

  it("rejects a candidate with extra colors (default config)", () => {
    expect(isCandidateLegal(c("Lightning Bolt", "Instant", ["R"]), [cmd])).toBe(false);
  });

  it("rejects banned cards by default", () => {
    expect(isCandidateLegal(c("Black Lotus", "Artifact", []), [cmd])).toBe(false);
  });

  it("allows out-of-CI candidates when colorIdentity is 'warn'", () => {
    expect(
      isCandidateLegal(c("Lightning Bolt", "Instant", ["R"]), [cmd], {
        ...DEFAULT_CONFIG,
        colorIdentity: "warn",
      }),
    ).toBe(true);
  });

  it("allows banned candidates when banlist is 'off'", () => {
    expect(
      isCandidateLegal(c("Black Lotus", "Artifact", []), [cmd], {
        ...DEFAULT_CONFIG,
        banlist: "off",
      }),
    ).toBe(true);
  });
});
