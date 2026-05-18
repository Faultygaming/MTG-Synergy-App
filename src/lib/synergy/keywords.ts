// Rules-based keyword extraction from a Scryfall card.
// v1 deliberately avoids NLP/ML — see README "Keyword extraction" for the v2
// upgrade path (Scryfall oracle tags + light NLP for ETB clustering).
//
// Sources combined here:
//   1. Scryfall's printed `keywords[]` array (e.g. "Flying", "Ward").
//   2. Tribe/type tokens from `type_line` (everything past the em-dash).
//   3. A small regex pack over `oracle_text` for high-signal templates that
//      Scryfall doesn't surface as keywords.
//
// All output is lower-kebab-case for stable graph identity (`enters-the-battlefield`).

import type { ScryfallCard } from "../scryfall";

export function normalizeKeyword(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Type lines where the part after the em-dash is a unique proper name
// (the plane "Zhalfir", the scheme "All in Good Time", the vanguard
// "Selvala") rather than a synergy-bearing subtype. Extracting these as
// keywords creates one-off noise in the global keyword index — they
// appear on a single card and nobody is building a "Zhalfir" deck.
// Stripping them at the extraction layer keeps the histogram clean.
const TYPELINE_NAMED_SUBTYPE_OWNERS = new Set([
  "plane",
  "phenomenon",
  "conspiracy",
  "scheme",
  "dungeon",
  "vanguard",
  "hero",
  "card", // very old "Card — Foo" relics
  // Planeswalker subtypes are character names ("Calix", "Dakkon",
  // "Jeska", …). With ~1 card per name they create one-off noise the
  // same way plane names do. Superfriends synergy is still captured by
  // the "planeswalker" type token harvested from BEFORE the em-dash.
  "planeswalker",
]);

// Subtypes after the em-dash in a type_line, e.g.
//   "Legendary Creature — Human Wizard" → ["human", "wizard"]
// "Creature — Goblin" → ["goblin"]
export function subtypesFromTypeLine(typeLine: string): string[] {
  // Scryfall uses either em-dash (—) or hyphen-minus depending on locale.
  const split = typeLine.split(/[—\-]/);
  if (split.length < 2) return [];

  // Skip subtypes for "named-subtype" types — see TYPELINE_NAMED_SUBTYPE_OWNERS.
  const beforeDash = split[0].toLowerCase();
  for (const owner of TYPELINE_NAMED_SUBTYPE_OWNERS) {
    if (beforeDash.includes(owner)) return [];
  }

  const tail = split.slice(1).join(" ").trim();
  return tail.split(/\s+/).filter(Boolean).map(normalizeKeyword);
}

// Hand-picked regex pack. Order matters only for de-dupe (we dedupe at the end).
// Each entry yields a single normalized keyword if its regex matches.
// Regex pack — synergy-archetype detectors over Scryfall oracle_text.
//
// Catalogue derived from a curated sweep of EDHREC theme pages plus
// Scryfall Tagger function tags (~120 archetypes). Each entry emits ONE
// kebab-case keyword when the regex matches; that keyword joins the
// extracted set and is then either a top-N driver (gold/silver/bronze
// tier) or a deck-level theme indicator for downstream analysis.
//
// Authoring notes:
//   - Word boundaries (\b) on common English words to avoid false
//     positives (e.g. "haste" matches in "haste" but not "Stormhaste").
//   - Non-greedy quantifiers (.*?) when matching variable-length
//     phrases between two anchors; bounded char classes ([^.]*?) so
//     we don't cross sentence boundaries.
//   - Patterns that overlap with printed Scryfall `keywords[]` (storm,
//     flashback, cycling, etc.) are still included as a fallback for
//     cards where the printed list is missing or where we're running
//     `reextract-keywords` without re-fetching the Scryfall payload.
//   - Mana-symbol patterns escape `{...}` literally and are
//     case-insensitive (Scryfall lower-cases the inside but we accept both).
const ORACLE_TEXT_PATTERNS: Array<{ keyword: string; pattern: RegExp }> = [
  // ── Triggered abilities (anchors many archetypes) ───────────────────
  { keyword: "etb-trigger",       pattern: /when(?:ever)?\s+[^.]*?enters(?:\s+the\s+battlefield)?/i },
  { keyword: "death-trigger",     pattern: /when(?:ever)?\s+[^.]*?dies/i },
  { keyword: "attack-trigger",    pattern: /when(?:ever)?\s+[^.]*?attacks/i },
  { keyword: "cast-trigger",      pattern: /when(?:ever)?\s+you\s+cast/i },
  { keyword: "spellslinger",      pattern: /when(?:ever)?\s+you\s+cast\s+(?:an?\s+)?(?:instant|sorcery|noncreature)/i },
  { keyword: "lifegain-trigger",  pattern: /when(?:ever)?\s+you\s+gain\s+life/i },
  { keyword: "lifeloss-trigger",  pattern: /when(?:ever)?\s+(?:a\s+player|an?\s+opponent|you)\s+lose(?:s)?\s+life/i },
  { keyword: "discard-payoff",    pattern: /when(?:ever)?\s+[^.]*?discards?\s+a\s+card/i },

  // ── Card advantage ────────────────────────────────────────────────
  { keyword: "draw",              pattern: /draw\s+(?:a|two|three|four|x)\s+cards?/i },
  { keyword: "wheel",             pattern: /(?:each player\s+(?:discards?\s+(?:their\s+)?hand|draws?\s+seven)|discard\s+your\s+hand,?\s*then\s+draws?)/i },
  { keyword: "loot",              pattern: /draws?\s+(?:a|two|three)\s+cards?,?\s+then\s+discards?/i },
  { keyword: "rummage",           pattern: /discards?\s+(?:a|two|three)\s+cards?,?\s+(?:then\s+)?draws?\s+(?:a|two|three)\s+cards?/i },
  { keyword: "scry",              pattern: /\bscry\s+\d/i },
  { keyword: "surveil",           pattern: /\bsurveil\s+\d/i },
  { keyword: "connive",           pattern: /\bconnive(?:s|d)?\b/i },
  { keyword: "impulse-draw",      pattern: /exile the top[^.]*?(?:until end of turn[^.]*?)?(?:you may play|may cast)/i },
  { keyword: "group-hug",         pattern: /each\s+(?:other\s+)?(?:player|opponent)\s+draws?/i },

  // ── Tutors ────────────────────────────────────────────────────────
  { keyword: "tutor",             pattern: /search your library for a [^.]*?card/i },
  { keyword: "tutor-creature",    pattern: /search your library for a (?:[^.]{0,30}?\s+)?creature\b/i },
  { keyword: "tutor-instant-sorcery", pattern: /search your library for an? (?:instant|sorcery)/i },
  { keyword: "tutor-artifact",    pattern: /search your library for an? (?:[^.]{0,30}?\s+)?artifact\b/i },
  { keyword: "tutor-enchantment", pattern: /search your library for an? (?:[^.]{0,30}?\s+)?enchantment\b/i },

  // ── Ramp / mana production ────────────────────────────────────────
  // Ramp catches basic-land tutors AND typed-land tutors. "[^.]{0,80}?"
  // is bounded so we don't cross sentence boundaries; the alternation
  // covers "a basic land", "up to two basic land cards", "any number of
  // land cards" (World Shaper), and "a Plains, Island, Swamp, Mountain,
  // or Forest card" (Skyshroud Claim, Three Visits, etc.).
  { keyword: "ramp",              pattern: /search your library for [^.]{0,80}?(?:\bland\b|\bforest\b|\bisland\b|\bplains\b|\bmountain\b|\bswamp\b|\bgate\b)/i },
  { keyword: "extra-land-drops",  pattern: /play (?:an? |two )?additional lands?/i },
  // Mana-rock / mana-dork are handled as context-aware extractions in
  // extractKeywords() — they need the type_line to disambiguate
  // (otherwise every basic Forest gets flagged as a "mana-rock").
  { keyword: "mana-doubler",      pattern: /(?:adds? an additional|that mana,?\s+(?:he|she|they)?\s*adds? twice|double the amount of mana)/i },
  // Ritual: matches "Add three mana of any one color" (paraphrased
  // tests) plus the real-Magic three-or-more pip mana symbol form
  // ("Add {B}{B}{B}." / "Add {R}{R}{R}{R}.") that Dark Ritual,
  // Pyretic Ritual, Seething Song, et al. actually use.
  { keyword: "ritual",            pattern: /add\s+(?:three|four|five|six|seven)\s+mana\b|add\s+(?:\{[wubrgc]\}\s*){3,}/i },

  // ── Tokens by type ────────────────────────────────────────────────
  { keyword: "token-maker",       pattern: /create[s]?\s+(?:a|an|one|two|three|x)\s+[^.]*?token/i },
  { keyword: "treasure",          pattern: /\btreasure\s+token/i },
  { keyword: "food",              pattern: /\bfood\s+token/i },
  { keyword: "blood",             pattern: /\bblood\s+token/i },
  { keyword: "clue",              pattern: /\bclue\s+token|\binvestigate\b/i },
  { keyword: "gold-token",        pattern: /\bgold\s+token/i },
  { keyword: "energy",            pattern: /\{e\}|\benergy\s+counter/i },
  { keyword: "manifest",          pattern: /\bmanifest(?:\s+dread)?\b/i },
  { keyword: "token-doubler",     pattern: /create\s+twice that many|put\s+twice that many/i },
  { keyword: "populate",          pattern: /\bpopulate\b/i },
  { keyword: "fabricate",         pattern: /\bfabricate\s+\d/i },
  { keyword: "amass",             pattern: /\bamass\s+(?:\d|orcs|zombies)/i },

  // ── Lands matter ──────────────────────────────────────────────────
  { keyword: "landfall",          pattern: /\blandfall\b|when(?:ever)?\s+[^.]*?land\s+(?:you control )?enters/i },
  // Land recursion: "You may play lands from your graveyard" (Crucible
  // / Ramunap Excavator), "Return target/all/each/any land card(s) from
  // your graveyard" (Life from the Loam, Splendid Reclamation,
  // Aftermath Analyst, World Shaper).
  { keyword: "land-recursion",    pattern: /play\s+lands?(?:\s+cards?)?\s+from\s+(?:your\s+)?graveyard|return\s+[^.]{0,40}?lands?(?:\s+cards?)?\s+from\s+(?:your\s+)?graveyard/i },
  { keyword: "lands-matter",      pattern: /(?:number of lands you control|for each land|whenever a land)/i },
  { keyword: "land-sacrifice",    pattern: /sacrifice\s+a\s+land\b/i },
  { keyword: "retrace",           pattern: /\bretrace\b/i },

  // ── Removal / interaction ─────────────────────────────────────────
  { keyword: "removal-targeted",  pattern: /destroy target|exile target (creature|permanent|nonland)/i },
  { keyword: "bounce",            pattern: /return\s+target\s+[^.]{1,40}?to\s+(?:its|their)\s+owner's\s+hand|return\s+target\s+[^.]{1,40}?to\s+your\s+hand/i },
  // Board wipe: catches "Destroy all creatures" (Wrath), "Exile all
  // multicolored permanents" (Ravnica at War), "Destroy each nonland
  // permanent" (Gaze of Granite), and damage-based sweepers like
  // Blasphemous Act ("deals 13 damage to each creature") and
  // Planetary Annihilation ("deals 6 damage to each creature").
  { keyword: "board-wipe",        pattern: /destroy all|exile all|destroy each [^.]{0,30}?(?:creature|permanent|nonland)|deals?\s+(?:\d+|x)\s+damage\s+to\s+each\s+(?:creature|player|opponent)/i },
  { keyword: "mass-artifact-removal", pattern: /destroy all artifacts|exile all artifacts/i },
  { keyword: "mass-enchantment-removal", pattern: /destroy all enchantments|exile all enchantments/i },
  { keyword: "edict",             pattern: /each\s+(?:player|opponent)\s+sacrifices\s+a\s+creature|target\s+(?:player|opponent)\s+sacrifices/i },
  { keyword: "fight",             pattern: /\bfights?\s+(?:another|target)\s+creature\b/i },
  // Damage-removal: previously required a literal digit ("deals 3
  // damage to ..."), missing X-spells (Worldsoul's Rage, Banefire) and
  // "deals damage to any target equal to ..." (Torrent of Fire). The
  // amount segment is now optional and accepts \d+ / x / that much.
  // We still require "any target" or "target ..." as the destination
  // so combat-damage triggers ("whenever this creature deals damage to
  // a player") don't false-fire.
  { keyword: "damage-removal",    pattern: /deals?\s+(?:(?:\d+|x|that much)\s+)?damage\s+to\s+(?:any target|target)/i },
  { keyword: "counterspell",      pattern: /counter target/i },
  { keyword: "cant-be-countered", pattern: /can't be countered/i },

  // ── Stax / disruption ─────────────────────────────────────────────
  { keyword: "tax-effect",        pattern: /spells?\s+cost\s+\{\d\}?\s*more|spells?\s+(?:your\s+)?opponents?\s+(?:cast\s+)?cost\s+\{\d\}\s+more/i },
  // Stax tap/untap: covers Winter Orb / Stasis ("don't untap"),
  // tap-on-upkeep effects ("doesn't untap during"), Static Orb-style
  // limits ("players can't untap more than two"), and one-shot tappers
  // ("tap all creatures").
  { keyword: "stax-tap-untap",    pattern: /don't untap|doesn't untap during|can't untap more than|players? can't untap|tap all (?:creatures|lands|permanents)/i },
  { keyword: "cant-attack-block", pattern: /can't attack(?: you)?|can't block/i },
  { keyword: "pillow-fort",       pattern: /can't attack you|attacking you costs/i },

  // ── Combat ────────────────────────────────────────────────────────
  { keyword: "pump-spell",        pattern: /gets?\s+\+\d+\/\+\d+\s+until\s+end\s+of\s+turn/i },
  { keyword: "anthem",            pattern: /creatures you control get \+\d+\/\+\d+/i },
  { keyword: "evasion-grant",     pattern: /can't be blocked|have(?:s)?\s+(?:flying|menace|trample|reach)\b/i },
  { keyword: "indestructible-grant", pattern: /gains?\s+indestructible|have\s+indestructible/i },
  { keyword: "protection-grant",  pattern: /gains?\s+hexproof|have\s+protection\s+from|gains?\s+protection\s+from/i },
  { keyword: "extra-combat",      pattern: /additional\s+combat\s+(?:phase|step)/i },
  { keyword: "double-strike",     pattern: /\bdouble\s+strike\b/i },
  { keyword: "first-strike",      pattern: /\bfirst\s+strike\b/i },
  { keyword: "infect-toxic",      pattern: /\binfect\b|\btoxic\s+\d|poison\s+counter/i },
  { keyword: "damage-doubler",    pattern: /deals?\s+(?:double|twice that much)\s+damage/i },

  // ── Sacrifice / aristocrats ───────────────────────────────────────
  { keyword: "sacrifice-outlet",  pattern: /sacrifice\s+a\s+(?:creature|permanent|artifact)/i },
  // Aristocrats: triggers off ANOTHER / A creature dying (not just
  // self-death). Allows "Whenever X or another creature dies" by
  // matching anywhere "another creature" or "a creature ... dies"
  // appears in the trigger condition.
  { keyword: "aristocrats",       pattern: /when(?:ever)?\s+[^.]{0,60}?(?:another|other|a)\s+(?:nontoken\s+)?creature[^.]{0,30}?dies/i },
  { keyword: "discard",           pattern: /target (?:player|opponent) discards/i },

  // ── Graveyard themes ──────────────────────────────────────────────
  { keyword: "graveyard-recursion", pattern: /return target [^.]*?(creature|permanent) card from your graveyard/i },
  { keyword: "reanimator",        pattern: /return\s+target\s+creature\s+card\s+from\s+(?:a|your)\s+graveyard\s+to\s+the\s+battlefield|put\s+target\s+creature\s+card\s+from\s+a\s+graveyard\s+onto\s+the\s+battlefield/i },
  { keyword: "self-mill",         pattern: /puts?\s+the\s+top\s+\w+\s+cards?\s+of\s+your\s+library\s+into\s+your\s+graveyard|\bmills?\s+\w+\s+cards?/i },
  { keyword: "mill",              pattern: /puts? .* cards? .* into .* graveyard|mills?/i },
  { keyword: "dredge",            pattern: /\bdredge\s+\d/i },
  { keyword: "madness",           pattern: /\bmadness\s+\{/i },
  { keyword: "threshold",         pattern: /\bthreshold\b|seven\s+or\s+more\s+cards?\s+in\s+your\s+graveyard/i },
  { keyword: "delirium",          pattern: /\bdelirium\b|four\s+or\s+more\s+card\s+types/i },
  { keyword: "undergrowth",       pattern: /\bundergrowth\b/i },
  { keyword: "escape",            pattern: /\bescape\b\s*[—\-{]/i },
  { keyword: "flashback",         pattern: /\bflashback\b/i },
  { keyword: "jump-start",        pattern: /\bjump-start\b/i },
  { keyword: "disturb",           pattern: /\bdisturb\b/i },

  // ── Counters ──────────────────────────────────────────────────────
  { keyword: "+1-+1-counters",    pattern: /\+1\/\+1 counter/i },
  { keyword: "-1--1-counters",    pattern: /-1\/-1 counter|\bwither\b/i },
  { keyword: "proliferate",       pattern: /\bproliferate\b/i },
  { keyword: "counter-doubler",   pattern: /that many plus|twice that many[^.]{0,30}?counters?|double the number of[^.]{0,30}?counters?/i },
  { keyword: "charge-counters",   pattern: /\bcharge\s+counter/i },

  // ── Spellslinger / spell-copy ─────────────────────────────────────
  { keyword: "prowess",           pattern: /\bprowess\b/i },
  { keyword: "storm",             pattern: /\bstorm\b\s+(?:—|\d|\(|\.|\,)/i },
  { keyword: "magecraft",         pattern: /\bmagecraft\b/i },
  { keyword: "spell-copy",        pattern: /copy\s+target\s+(?:instant\s+or\s+sorcery\s+)?spell|copy\s+that\s+spell/i },

  // ── Enchantments matter ───────────────────────────────────────────
  { keyword: "enchantments-matter", pattern: /when(?:ever)?\s+(?:you cast|an?)\s+(?:an?\s+)?enchantment|\bconstellation\b/i },
  { keyword: "aura-anchor",       pattern: /\benchanted\s+creature\b|\bauras?\s+you\s+control\b/i },

  // ── Artifacts matter ──────────────────────────────────────────────
  { keyword: "artifacts-matter",  pattern: /when(?:ever)?\s+(?:you cast|an?)\s+(?:an?\s+)?artifact|for\s+each\s+artifact/i },
  { keyword: "affinity",          pattern: /\baffinity for\b/i },
  { keyword: "metalcraft",        pattern: /\bmetalcraft\b|three or more artifacts/i },
  { keyword: "improvise",         pattern: /\bimprovise\b/i },
  { keyword: "modular",           pattern: /\bmodular\b/i },
  { keyword: "attractions",       pattern: /\bopen an attraction\b|\battractions you control\b/i },

  // ── Voltron / equipment ───────────────────────────────────────────
  { keyword: "equipment-anchor",  pattern: /\bequipped\s+creature\b|\bequip\s+\{/i },
  { keyword: "living-weapon",     pattern: /\bliving\s+weapon\b/i },

  // ── Tribal / typal ────────────────────────────────────────────────
  { keyword: "tribal-lord",       pattern: /other\s+[^.]{1,30}?\s+(?:creatures|you control)\s+get\s+\+\d+\/\+\d+/i },
  { keyword: "changeling",        pattern: /\bchangeling\b/i },
  // Generic spell cost reduction. The previous "tribal-cost-reduction"
  // pattern matched Blasphemous Act ("costs {1} less for each creature
  // on the battlefield"), so we widened it to "cost-reduction" and
  // dropped the false-tribal label. True tribal cost reduction
  // (Urza's Incubator, Heartstone) gets caught here too — UI/scoring
  // can still discover the tribe via the tribe keyword on the same card.
  { keyword: "cost-reduction",    pattern: /this\s+spell\s+costs\s+\{\d\}\s+less|spells?\s+you\s+cast\s+costs?\s+\{\d\}\s+less|\bcreature\s+spells?\s+(?:you\s+cast\s+)?costs?\s+\{\d\}\s+less/i },

  // ── Politics / multiplayer ────────────────────────────────────────
  { keyword: "monarch",           pattern: /\bbecomes? the monarch\b|you're the monarch/i },
  { keyword: "initiative",        pattern: /\btake the initiative\b|\bthe initiative\b/i },
  { keyword: "goad",              pattern: /\bgoad(?:s|ed)?\b/i },
  { keyword: "vote",              pattern: /\bvote\b|council's dilemma/i },

  // ── Lifegain ──────────────────────────────────────────────────────
  { keyword: "lifegain",          pattern: /gain\s+\d+\s+life|you gain life/i },
  // Also match "you lose life equal to ..." (Reanimate / Bargain
   // costs that scale with mana value rather than a fixed integer).
  { keyword: "life-as-cost",      pattern: /pay\s+\d+\s+life|you\s+lose\s+(?:\d+|x)?\s*life/i },
  { keyword: "lifegain-doubler",  pattern: /twice that much life|gain twice/i },

  // ── Combo / win-cons ──────────────────────────────────────────────
  { keyword: "extra-turn",        pattern: /take an extra turn|extra turn after this/i },
  { keyword: "alt-win",           pattern: /\byou win the game\b/i },
  { keyword: "alt-lose",          pattern: /that player loses the game/i },
  { keyword: "commander-damage",  pattern: /\bcommander damage\b|from the command zone/i },

  // ── Hand size ─────────────────────────────────────────────────────
  { keyword: "no-max-hand",       pattern: /no maximum hand size/i },
  { keyword: "hellbent",          pattern: /\bhellbent\b|no cards? in (?:your )?hand/i },

  // ── X-spells / devotion / hybrid ──────────────────────────────────
  { keyword: "x-spell",           pattern: /\bwhere x is\b/i },
  { keyword: "devotion",          pattern: /\bdevotion to\b/i },
  { keyword: "hybrid-mana",       pattern: /\{[wubrg]\/[wubrg]\}/i },

  // ── Engine mechanics ──────────────────────────────────────────────
  { keyword: "blink",             pattern: /exile [^.]*?then return (it|them) to the battlefield/i },
  { keyword: "cascade",           pattern: /\bcascade\b/i },

  // ── Misc mechanics (often printed-keyword, kept as fallback) ──────
  { keyword: "kicker",            pattern: /\bkicker\b|\bkicked\b/i },
  { keyword: "cycling",           pattern: /\bcycling\s+\{|\bcycle\b/i },
  { keyword: "morph",             pattern: /\bmorph\s+\{|\bface-down\b/i },
  { keyword: "foretell",          pattern: /\bforetell\b/i },
  { keyword: "suspend",           pattern: /\bsuspend\s+\d/i },
  { keyword: "plot",              pattern: /\bplot\b\s*[—\-:]/i },
  { keyword: "gift",              pattern: /\bgift a\b|with the promised gift/i },

  // ── Evergreen mechanics (already on Scryfall keywords[] but
  //     kept here as a fallback for reextract-keywords) ──────────────
  { keyword: "haste",             pattern: /\bhaste\b/i },
  { keyword: "indestructible",    pattern: /\bindestructible\b/i },
  { keyword: "hexproof",          pattern: /\bhexproof\b/i },
  { keyword: "flying",            pattern: /\bflying\b/i },
  { keyword: "trample",           pattern: /\btrample\b/i },
  { keyword: "deathtouch",        pattern: /\bdeathtouch\b/i },
  { keyword: "lifelink",          pattern: /\blifelink\b/i },
  { keyword: "vigilance",         pattern: /\bvigilance\b/i },
  { keyword: "menace",            pattern: /\bmenace\b/i },
  { keyword: "reach",             pattern: /\breach\b/i },
  { keyword: "defender",          pattern: /\bdefender\b/i },
  { keyword: "flash",             pattern: /\bflash\b/i },
  { keyword: "ward",              pattern: /\bward\s+\{|\bward\s+\d/i },
];

export function extractKeywords(
  card: Pick<ScryfallCard, "keywords" | "type_line" | "oracle_text" | "produced_mana">,
  // Optional: Scryfall oracle tags attached to this card by the Tagger
  // (e.g. ["ramp", "card-advantage", "synergy-graveyard"]). When provided,
  // they're unioned into the keyword set alongside printed keywords. The
  // ingest script (`pnpm ingest:tags`) is responsible for populating these
  // per card; runtime callers pass [] when tags haven't been ingested yet.
  oracleTags: string[] = [],
): string[] {
  const out = new Set<string>();

  // 1. Printed keywords from Scryfall.
  for (const k of card.keywords ?? []) out.add(normalizeKeyword(k));

  // 2. Type-line subtypes → tribes / artifact-types / land-types.
  for (const t of subtypesFromTypeLine(card.type_line ?? "")) {
    if (t) out.add(t);
  }

  // 3. Supertype/type tokens before the dash (creature, instant, ...).
  const beforeDash = (card.type_line ?? "").split(/[—\-]/)[0] ?? "";
  for (const t of beforeDash.split(/\s+/).filter(Boolean)) {
    out.add(normalizeKeyword(t));
  }

  // 4. produced_mana → color/mana-production tags. e.g. ["R"] → "produces-r".
  for (const m of card.produced_mana ?? []) {
    out.add(`produces-${normalizeKeyword(m)}`);
  }

  // 4b. Mana fixing on lands. After the mana-rock fix, dual lands /
  // tri-lands / Command Tower lose their (bogus) mana-rock tag and end
  // up with NO archetype keyword — but they're load-bearing in any
  // multi-color deck. A multi-color land is one with type "Land" and
  // 2+ entries in produced_mana. Artifact mana fixers (Chromatic Lantern)
  // are already covered by "mana-rock".
  if (
    /\bland\b/i.test(card.type_line ?? "") &&
    (card.produced_mana?.length ?? 0) >= 2
  ) {
    out.add("mana-fixing");
  }

  // 5. Regex pack over oracle text.
  const text = card.oracle_text ?? "";
  if (text) {
    for (const { keyword, pattern } of ORACLE_TEXT_PATTERNS) {
      if (pattern.test(text)) out.add(keyword);
    }
  }

  // 5b. Context-aware mana producers. "{T}: Add {G}." on a Forest is
  // not a "mana-rock" — it's a basic land. We bucket the tap-for-mana
  // pattern by type_line:
  //   - Artifact (not a land): mana-rock      (Sol Ring, Mana Crypt)
  //   - Creature (not a land): mana-dork      (Llanowar Elves, Birds)
  //   - Land:                  intentionally no keyword (handled by
  //                            the land subtypes & "produces-X" tags)
  // The pattern accepts a generic "Add one mana of any color" too
  // (Birds of Paradise) — Add{ or Add\s+one\s+mana both qualify.
  const TAP_FOR_MANA = /\{T\}:\s*add(?:\s+one\s+mana|\s+\{)/i;
  if (TAP_FOR_MANA.test(text)) {
    const typeLine = card.type_line ?? "";
    const isLand = /\bland\b/i.test(typeLine);
    if (!isLand) {
      if (/\bartifact\b/i.test(typeLine)) out.add("mana-rock");
      if (/\bcreature\b/i.test(typeLine)) out.add("mana-dork");
    }
  }

  // 6. Scryfall oracle tags. Namespaced with "otag:" so they don't collide
  // with regex-pack labels and remain attributable (e.g. an EDHREC search
  // by tag still works).
  for (const t of oracleTags) {
    const n = normalizeKeyword(t);
    if (n) out.add(`otag:${n}`);
  }

  // Drop noise tokens that don't carry synergy signal.
  const NOISE = new Set(["legendary", "basic", "snow", "tribal", "—", ""]);
  for (const n of NOISE) out.delete(n);

  return Array.from(out).sort();
}
