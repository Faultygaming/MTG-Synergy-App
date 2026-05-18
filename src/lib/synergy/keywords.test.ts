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

  // Plane / Phenomenon / Vanguard / etc. have UNIQUE NAMES as subtypes
  // (e.g. "Plane — Zhalfir", "Vanguard — Selvala"). Those names create
  // 1-card keyword entries that pollute the global histogram, so we
  // strip the subtype list for these owner types. The card still
  // contributes its supertype/type tokens (plane, phenomenon, …).
  it("drops unique-name subtypes for Plane / Vanguard / Scheme", () => {
    expect(subtypesFromTypeLine("Plane — Zhalfir")).toEqual([]);
    expect(subtypesFromTypeLine("Phenomenon — Spatial Merging")).toEqual([]);
    expect(subtypesFromTypeLine("Vanguard — Selvala")).toEqual([]);
    expect(subtypesFromTypeLine("Scheme — All in Good Time")).toEqual([]);
    expect(subtypesFromTypeLine("Dungeon — Lost Mine of Phandelver")).toEqual([]);
    expect(subtypesFromTypeLine("Conspiracy — Hidden Agenda")).toEqual([]);
  });

  // Planeswalker subtypes are character names ("Calix", "Dakkon",
  // "Jeska", "Niko"). Same one-off-noise problem as plane names.
  it("drops planeswalker character-name subtypes", () => {
    expect(subtypesFromTypeLine("Legendary Planeswalker — Calix")).toEqual([]);
    expect(subtypesFromTypeLine("Legendary Planeswalker — Jeska")).toEqual([]);
    expect(subtypesFromTypeLine("Planeswalker — Dakkon")).toEqual([]);
  });

  // Planeswalker emblems are tokens with the character name as subtype
  // ("Emblem — Arlinn", "Emblem — Sarkhan", "Emblem — Tibalt", ...).
  // Every 1-card planeswalker name in the audit traced back to here.
  it("drops planeswalker-emblem subtypes", () => {
    expect(subtypesFromTypeLine("Emblem — Arlinn")).toEqual([]);
    expect(subtypesFromTypeLine("Emblem — Sarkhan")).toEqual([]);
    expect(subtypesFromTypeLine("Emblem — Tibalt")).toEqual([]);
    expect(subtypesFromTypeLine("Emblem — Wrenn")).toEqual([]);
  });

  it("drops sticker / art-series subtypes (unique names)", () => {
    expect(subtypesFromTypeLine("Stickers — Wacky Stickers")).toEqual([]);
    expect(subtypesFromTypeLine("Card — Art Series")).toEqual([]);
  });

  // DFC / MDFC: "front // back" type_lines must be processed per face,
  // otherwise the planeswalker back leaks its character name through
  // the creature front. Arlinn Kord, Garruk Relentless, Huatli, etc.
  it("processes DFC type_lines per face (planeswalker back doesn't leak)", () => {
    expect(
      subtypesFromTypeLine(
        "Legendary Creature — Human Werewolf // Legendary Planeswalker — Arlinn",
      ),
    ).toEqual(expect.arrayContaining(["human", "werewolf"]));
    expect(
      subtypesFromTypeLine(
        "Legendary Creature — Human Werewolf // Legendary Planeswalker — Arlinn",
      ),
    ).not.toContain("arlinn");
  });

  it("processes DFC type_lines where one face is a named-subtype owner", () => {
    // Plane front, Creature back (hypothetical) — subtypes survive
    // from the creature face only.
    expect(
      subtypesFromTypeLine("Plane — Zhalfir // Creature — Soldier"),
    ).toEqual(["soldier"]);
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

  // Audit (May 2026) showed these basic-land tutors had ZERO keywords.
  // The previous ramp regex required "a/an" before the land noun, which
  // missed "up to two basic land cards" and typed-land tutors.
  it("tags Cultivate (up to two basic lands) with ramp", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
      produced_mana: [],
    });
    expect(kws).toContain("ramp");
  });

  it("tags Skyshroud Claim (typed land tutor) with ramp", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "Search your library for up to two Forest cards, put them onto the battlefield, then shuffle.",
      produced_mana: [],
    });
    expect(kws).toContain("ramp");
  });

  it("tags World Shaper (any-number land tutor) with ramp", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Creature — Elemental",
      oracle_text:
        "When World Shaper dies, you may shuffle your graveyard into your library. When you do, search your library for any number of land cards and put them onto the battlefield tapped.",
      produced_mana: [],
    });
    expect(kws).toContain("ramp");
    expect(kws).toContain("death-trigger");
  });

  it("tags Splendid Reclamation (return all lands) with land-recursion", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "Return all land cards from your graveyard to the battlefield tapped.",
      produced_mana: [],
    });
    expect(kws).toContain("land-recursion");
  });

  it("tags Aftermath Analyst (return all lands) with land-recursion", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Creature — Human Druid",
      oracle_text:
        "{2}{G}, Sacrifice Aftermath Analyst: Return all land cards from your graveyard to the battlefield tapped.",
      produced_mana: [],
    });
    expect(kws).toContain("land-recursion");
  });

  // mana-rock / mana-dork are now context-aware: type_line decides.
  it("tags Sol Ring as mana-rock (artifact), not basic lands", () => {
    const sol = extractKeywords({
      keywords: [],
      type_line: "Artifact",
      oracle_text: "{T}: Add {C}{C}.",
      produced_mana: ["C"],
    });
    expect(sol).toContain("mana-rock");
    expect(sol).not.toContain("mana-dork");

    const forest = extractKeywords({
      keywords: [],
      type_line: "Basic Land — Forest",
      oracle_text: "{T}: Add {G}.",
      produced_mana: ["G"],
    });
    expect(forest).not.toContain("mana-rock");
    expect(forest).not.toContain("mana-dork");
  });

  it("tags Llanowar Elves as mana-dork (creature), not mana-rock", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Creature — Elf Druid",
      oracle_text: "{T}: Add {G}.",
      produced_mana: ["G"],
    });
    expect(kws).toContain("mana-dork");
    expect(kws).not.toContain("mana-rock");
  });

  // Static Orb: the audit showed it returned zero archetype keywords
  // because stax-tap-untap only matched "don't untap" / "doesn't untap
  // during", missing "can't untap more than".
  it("tags Static Orb with stax-tap-untap", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Artifact",
      oracle_text:
        "As long as Static Orb is untapped, players can't untap more than two permanents during their untap steps.",
      produced_mana: [],
    });
    expect(kws).toContain("stax-tap-untap");
  });

  // Real Dark Ritual's oracle text is "Add {B}{B}{B}." — the previous
  // ritual regex only matched the paraphrased "three mana" wording.
  it("tags real Dark Ritual ({B}{B}{B} form) with ritual", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Instant",
      oracle_text: "Add {B}{B}{B}.",
      produced_mana: ["B"],
    });
    expect(kws).toContain("ritual");
  });

  // Blasphemous Act has cost reduction that depended on board state,
  // not tribe. The renamed "cost-reduction" keyword keeps catching it
  // without the misleading "tribal-" prefix.
  it("renames tribal-cost-reduction → cost-reduction (no false tribal label)", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "This spell costs {1} less to cast for each creature on the battlefield. Destroy all creatures.",
      produced_mana: [],
    });
    expect(kws).toContain("cost-reduction");
    expect(kws).not.toContain("tribal-cost-reduction");
  });

  // X-damage and "deals damage equal to ..." spells were missed by the
  // old damage-removal regex (literal-digit only).
  it("tags Worldsoul's Rage (X-damage) with damage-removal", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "Worldsoul's Rage deals X damage to any target. Put up to X land cards from your hand and/or graveyard onto the battlefield tapped.",
      produced_mana: [],
    });
    expect(kws).toContain("damage-removal");
  });

  it("tags Torrent of Fire ('deals damage equal to') with damage-removal", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "Torrent of Fire deals damage to any target equal to the greatest mana value among permanents you control.",
      produced_mana: [],
    });
    expect(kws).toContain("damage-removal");
  });

  // "Destroy each ..." and damage-based sweepers were missed by the
  // old board-wipe regex.
  it("tags Gaze of Granite ('destroy each nonland permanent') with board-wipe", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text: "Destroy each nonland permanent with mana value X or less.",
      produced_mana: [],
    });
    expect(kws).toContain("board-wipe");
  });

  it("tags Blasphemous Act (damage to each creature) with board-wipe", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "This spell costs {1} less to cast for each creature on the battlefield. Blasphemous Act deals 13 damage to each creature.",
      produced_mana: [],
    });
    expect(kws).toContain("board-wipe");
  });

  // Multi-color lands (Command Tower, Cinder Glade, triomes, fetches
  // that produce two colors) used to be falsely tagged "mana-rock".
  // After context-aware mana-rock, they need a positive label —
  // "mana-fixing" — so they still surface as load-bearing deck pieces.
  it("tags Cinder Glade (dual land) with mana-fixing, not mana-rock", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Land — Mountain Forest",
      oracle_text:
        "({T}: Add {R} or {G}.) This land enters tapped unless you control two or more basic lands.",
      produced_mana: ["R", "G"],
    });
    expect(kws).toContain("mana-fixing");
    expect(kws).not.toContain("mana-rock");
  });

  it("tags Command Tower (5-color land) with mana-fixing", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Land",
      oracle_text:
        "{T}: Add one mana of any color in your commander's color identity.",
      produced_mana: ["W", "U", "B", "R", "G"],
    });
    expect(kws).toContain("mana-fixing");
    expect(kws).not.toContain("mana-rock");
  });

  it("does NOT tag basic Forest with mana-fixing (single color)", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Basic Land — Forest",
      oracle_text: "({T}: Add {G}.)",
      produced_mana: ["G"],
    });
    expect(kws).not.toContain("mana-fixing");
    expect(kws).not.toContain("mana-rock");
  });

  // Artifact mana fixers should ALSO get mana-fixing (in addition to
  // mana-rock). Otherwise Arcane Signet / Chromatic Lantern / Coalition
  // Relic look indistinguishable from Sol Ring in the synergy index.
  it("tags Arcane Signet (multi-color artifact) with mana-fixing + mana-rock", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Artifact",
      oracle_text:
        "{T}: Add one mana of any color in your commander's color identity.",
      produced_mana: ["W", "U", "B", "R", "G"],
    });
    expect(kws).toContain("mana-rock");
    expect(kws).toContain("mana-fixing");
  });

  it("does NOT tag Sol Ring (colorless-only) with mana-fixing", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Artifact",
      oracle_text: "{T}: Add {C}{C}.",
      produced_mana: ["C"],
    });
    expect(kws).toContain("mana-rock");
    expect(kws).not.toContain("mana-fixing");
  });

  // Crucible of Fire is a TRIBAL anthem ("Dragon creatures you control
  // get +1/+1") — not a generic anthem. The old anthem regex matched
  // it and falsely promoted Crucible of Fire to gold tier for the
  // tokens theme in a deck with many token-makers. Anchored regex
  // only matches generic / "All "/"Other " / sentence-start forms.
  it("does NOT tag Crucible of Fire (tribal anthem) as plain anthem", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Enchantment",
      oracle_text: "Dragon creatures you control get +1/+1.",
      produced_mana: [],
    });
    expect(kws).not.toContain("anthem");
  });

  it("tags generic anthems (Glorious Anthem)", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Enchantment",
      oracle_text: "Creatures you control get +1/+1.",
      produced_mana: [],
    });
    expect(kws).toContain("anthem");
  });

  it("tags 'All creatures you control' anthems", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line: "Enchantment",
      oracle_text: "Some flavor text. All creatures you control get +1/+1.",
      produced_mana: [],
    });
    expect(kws).toContain("anthem");
  });

  // Fetch lands and land-ramp spells used to get tagged ramp + tutor.
  // The double-tag inflated the deck's tutor count enough to crowd
  // real archetypes out of bronze tier in lands-matter decks.
  it("strips tutor when ramp is set (fetch lands / land-ramp spells)", () => {
    const fetch = extractKeywords({
      keywords: [],
      type_line: "Land",
      oracle_text:
        "When this land enters the battlefield, sacrifice it unless you pay {1}. {T}, Sacrifice this land: Search your library for a basic Plains, Island, Swamp, Mountain, or Forest card, put it onto the battlefield, then shuffle.",
      produced_mana: [],
    });
    expect(fetch).toContain("ramp");
    expect(fetch).not.toContain("tutor");

    const farseek = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.",
      produced_mana: [],
    });
    expect(farseek).toContain("ramp");
    expect(farseek).not.toContain("tutor");
  });

  it("keeps tutor for real card tutors (no land in search target)", () => {
    const demonicTutor = extractKeywords({
      keywords: [],
      type_line: "Sorcery",
      oracle_text:
        "Search your library for a card, put that card into your hand, then shuffle.",
      produced_mana: [],
    });
    expect(demonicTutor).toContain("tutor");
    expect(demonicTutor).not.toContain("ramp");
  });

  // DFC creature // planeswalker — both faces' supertype tokens should
  // surface (creature + planeswalker), but the planeswalker character
  // name on the back is stripped via subtypesFromTypeLine.
  it("DFC creature // planeswalker adds both type tokens, no character name", () => {
    const kws = extractKeywords({
      keywords: [],
      type_line:
        "Legendary Creature — Human Werewolf // Legendary Planeswalker — Arlinn",
      oracle_text: "Daybound",
      produced_mana: [],
    });
    expect(kws).toContain("creature");
    expect(kws).toContain("planeswalker");
    expect(kws).toContain("human");
    expect(kws).toContain("werewolf");
    expect(kws).not.toContain("arlinn");
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
