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
});
