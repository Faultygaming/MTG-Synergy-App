import { describe, expect, it } from "vitest";
import { extractKeywords, normalizeKeyword, subtypesFromTypeLine } from "./keywords";

describe("normalizeKeyword", () => {
  it("lower-kebabs strings", () => {
    expect(normalizeKeyword("Enters The Battlefield")).toBe(
      "enters-the-battlefield",
    );
    expect(normalizeKeyword("+1/+1 Counters")).toBe("1-1-counters");
  });
});

describe("subtypesFromTypeLine", () => {
  it("extracts subtypes after the em-dash", () => {
    expect(subtypesFromTypeLine("Legendary Creature — Human Wizard")).toEqual([
      "human",
      "wizard",
    ]);
  });

  it("returns empty array when there's no subtype", () => {
    expect(subtypesFromTypeLine("Sorcery")).toEqual([]);
  });
});

describe("extractKeywords", () => {
  it("combines printed keywords, tribes, and oracle-text patterns", () => {
    const kws = extractKeywords({
      keywords: ["Flying"],
      type_line: "Creature — Elf Druid",
      oracle_text:
        "When this creature enters the battlefield, draw a card. {T}: Add {G}.",
      produced_mana: ["G"],
    });
    expect(kws).toContain("flying");
    expect(kws).toContain("elf");
    expect(kws).toContain("druid");
    expect(kws).toContain("creature");
    expect(kws).toContain("etb-trigger");
    expect(kws).toContain("draw");
    expect(kws).toContain("produces-g");
  });

  it("drops noise tokens like 'legendary' and 'basic'", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Legendary Creature — Elf",
      oracle_text: "",
      produced_mana: [],
    });
    expect(kws).not.toContain("legendary");
    expect(kws).toContain("elf");
  });

  it("flags ramp from 'search your library for a basic land'", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
      produced_mana: [],
    });
    expect(kws).toContain("ramp");
  });

  // Hearthhull / World Shaper-style archetype checks. These cards used
  // to extract to just ["artifact"] / ["creature"] and missed the
  // landfall-recursion theme entirely. The new regex pack catches them.
  it("tags Crucible of Worlds with land-recursion", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Artifact",
      oracle_text: "You may play lands from your graveyard.",
      produced_mana: [],
    });
    expect(kws).toContain("land-recursion");
  });

  it("tags Ramunap Excavator with land-recursion", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Creature — Naga Cleric",
      oracle_text: "You may play land cards from your graveyard.",
      produced_mana: [],
    });
    expect(kws).toContain("land-recursion");
  });

  it("tags Exploration with extra-land-drops", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Enchantment",
      oracle_text: "You may play an additional land on each of your turns.",
      produced_mana: [],
    });
    expect(kws).toContain("extra-land-drops");
  });

  it("tags Lord Windgrace-style landfall payoffs", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Legendary Creature — Beast",
      oracle_text: "Landfall — Whenever a land you control enters, create a 2/2 green Cat Warrior creature token.",
      produced_mana: [],
    });
    expect(kws).toContain("landfall");
  });

  it("tags Dockside Extortionist with treasure", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Creature — Goblin Pirate",
      oracle_text:
        "When Dockside Extortionist enters the battlefield, create X Treasure tokens, where X is the number of artifacts and enchantments your opponents control.",
      produced_mana: [],
    });
    expect(kws).toContain("treasure");
  });

  it("tags 'lands matter' cards like Rampaging Baloths", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Creature — Beast",
      oracle_text:
        "Trample. Landfall — Whenever a land you control enters, create a 3/3 green Beast creature token.",
      produced_mana: [],
    });
    expect(kws).toContain("landfall");
  });

  it("unions Scryfall oracle tags into the keyword set as 'otag:*'", () => {
    const kws = extractKeywords(
      {
        keywords: [],
        type_line: "Creature — Elf Druid",
        oracle_text: "",
        produced_mana: [],
      },
      ["ramp", "mana-dork", "card-advantage"],
    );
    expect(kws).toContain("otag:ramp");
    expect(kws).toContain("otag:mana-dork");
    expect(kws).toContain("otag:card-advantage");
  });

  it("normalizes oracle tags (case + punctuation) when unioning", () => {
    const kws = extractKeywords(
      { keywords: [], type_line: "Sorcery", oracle_text: "", produced_mana: [] },
      ["Card Advantage", "+1/+1 Counters"],
    );
    expect(kws).toContain("otag:card-advantage");
    expect(kws).toContain("otag:1-1-counters");
  });

  it("empty oracle-tag list is a no-op (back-compat)", () => {
    const a = extractKeywords({
      keywords: ["Flying"],
      type_line: "Creature — Bird",
      oracle_text: "",
      produced_mana: [],
    });
    const b = extractKeywords(
      {
        keywords: ["Flying"],
        type_line: "Creature — Bird",
        oracle_text: "",
        produced_mana: [],
      },
      [],
    );
    expect(a).toEqual(b);
  });
});
