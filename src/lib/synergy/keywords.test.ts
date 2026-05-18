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

  // ── Expanded regex pack coverage tests ───────────────────────────
  // One representative oracle text per archetype family. Each card name
  // is real and the oracle text is its (paraphrased) Scryfall text.
  const cases: Array<{ name: string; type: string; text: string; expected: string[] }> = [
    {
      name: "Wheel of Fortune",
      type: "Sorcery",
      text: "Each player discards their hand, then draws seven cards.",
      expected: ["wheel"],
    },
    {
      name: "Faithless Looting",
      type: "Sorcery",
      text: "Draw two cards, then discard two cards. Flashback {2}{R}.",
      expected: ["loot", "flashback"],
    },
    {
      name: "Preordain",
      type: "Sorcery",
      text: "Scry 2, then draw a card.",
      expected: ["scry", "draw"],
    },
    {
      name: "Ledger Shredder",
      type: "Creature — Bird Advisor",
      text: "Flying. Whenever a player casts their second spell each turn, this connives.",
      expected: ["connive", "flying"],
    },
    {
      name: "Dark Ritual",
      type: "Instant",
      text: "Add three mana of any one color.",
      expected: ["ritual"],
    },
    {
      name: "Dockside Extortionist",
      type: "Creature — Goblin Pirate",
      text: "When Dockside Extortionist enters the battlefield, create X Treasure tokens, where X is the number of artifacts and enchantments your opponents control.",
      expected: ["treasure", "token-maker", "etb-trigger"],
    },
    {
      name: "Gilded Goose",
      type: "Creature — Bird",
      text: "When Gilded Goose enters the battlefield, create a Food token.",
      expected: ["food", "etb-trigger"],
    },
    {
      name: "Tireless Tracker",
      type: "Creature — Human Scout",
      text: "Whenever a land enters the battlefield under your control, investigate.",
      expected: ["clue", "landfall"],
    },
    {
      name: "Counterspell",
      type: "Instant",
      text: "Counter target spell.",
      expected: ["counterspell"],
    },
    {
      name: "Cyclonic Rift",
      type: "Instant",
      text: "Return target nonland permanent you don't control to its owner's hand.",
      expected: ["bounce"],
    },
    {
      name: "Diabolic Edict",
      type: "Instant",
      text: "Target player sacrifices a creature.",
      expected: ["edict"],
    },
    {
      name: "Wrath of God",
      type: "Sorcery",
      text: "Destroy all creatures. They can't be regenerated.",
      expected: ["board-wipe"],
    },
    {
      name: "Reanimate",
      type: "Sorcery",
      text: "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.",
      expected: ["reanimator", "life-as-cost"],
    },
    {
      name: "Stitcher's Supplier",
      type: "Creature — Zombie",
      text: "When Stitcher's Supplier enters the battlefield or dies, mill three cards.",
      expected: ["self-mill", "etb-trigger", "death-trigger"],
    },
    {
      name: "Blood Artist",
      type: "Creature — Vampire",
      text: "Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.",
      expected: ["aristocrats", "lifegain", "death-trigger"],
    },
    {
      name: "Young Pyromancer",
      type: "Creature — Human Shaman",
      text: "Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.",
      expected: ["spellslinger", "cast-trigger", "token-maker"],
    },
    {
      name: "Atraxa, Praetors' Voice",
      type: "Legendary Creature — Phyrexian Angel Horror",
      text: "Flying, vigilance, deathtouch, lifelink. At the beginning of your end step, proliferate.",
      expected: ["proliferate", "flying", "vigilance", "deathtouch", "lifelink"],
    },
    {
      name: "Hardened Scales",
      type: "Enchantment",
      text: "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.",
      expected: ["counter-doubler", "+1-+1-counters"],
    },
    {
      name: "Lord of Atlantis",
      type: "Creature — Merfolk",
      text: "Other Merfolk creatures you control get +1/+1 and have islandwalk.",
      expected: ["tribal-lord", "merfolk"],
    },
    {
      name: "Aggravated Assault",
      type: "Enchantment",
      text: "{3}{R}: Untap all creatures you control. After this main phase, there is an additional combat phase followed by an additional main phase.",
      expected: ["extra-combat"],
    },
    {
      name: "Glistener Elf",
      type: "Creature — Elf",
      text: "Infect.",
      expected: ["infect-toxic", "elf"],
    },
    {
      name: "Approach of the Second Sun",
      type: "Sorcery",
      text: "If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game.",
      expected: ["alt-win"],
    },
    {
      name: "Reliquary Tower",
      type: "Land",
      text: "You have no maximum hand size.",
      expected: ["no-max-hand"],
    },
    {
      name: "Skyline Despot",
      type: "Creature — Dragon",
      text: "When Skyline Despot enters the battlefield, you become the monarch.",
      expected: ["monarch", "etb-trigger", "dragon"],
    },
    {
      name: "Disrupt Decorum",
      type: "Sorcery",
      text: "Goad all creatures your opponents control.",
      expected: ["goad"],
    },
    {
      name: "Aetherflux Reservoir",
      type: "Artifact",
      text: "Whenever you cast a spell, you gain 1 life for each spell you've cast this turn. Pay 50 life: This deals 50 damage to any target.",
      expected: ["cast-trigger", "life-as-cost"],
    },
  ];

  for (const c of cases) {
    it(`${c.name} — extracts [${c.expected.join(", ")}]`, () => {
      const kws = extractKeywords({
        keywords: [],
        type_line: c.type,
        oracle_text: c.text,
        produced_mana: [],
      });
      for (const exp of c.expected) {
        expect(kws).toContain(exp);
      }
    });
  }
});
