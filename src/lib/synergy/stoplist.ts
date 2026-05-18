// Categorized "common keyword" stoplist for the synergy ranker. Keywords
// on this list always exist in the DB (Card.keywordsJson keeps them) but
// are hidden by default from the deck's top-N ranking, the tier
// classification, and the map's edges. UI exposes a toggle to bring them
// back.
//
// Why: words like `creature`, `land`, `produces-g` are on practically
// every deck. If we don't filter them, they always top the frequency
// list and the gold-tier slot collapses to "the deck has creatures",
// drowning out the actual synergy themes (landfall, etb-trigger,
// lifegain, etc.).
//
// Sourcing: rationale and category breakdown documented in CLAUDE.md.
// Each category can be toggled independently by the UI if we ever need
// per-category control.

// ── Card types ──────────────────────────────────────────────────────
// Every card has at least one of these. Includes the rare-format types
// for completeness even though they almost never show up in commander.
export const TYPE_STOPLIST = new Set<string>([
  "creature", "instant", "sorcery", "artifact", "enchantment", "land",
  "planeswalker", "battle", "kindred", "tribal",
  "dungeon", "plane", "phenomenon", "scheme", "conspiracy", "vanguard",
]);

// ── Supertypes ───────────────────────────────────────────────────────
// All five canonical supertypes. `snow` is debatable (snow-matters is a
// real archetype, e.g. Marit Lage) but defaulting off and exposing a
// toggle is the safer call.
export const SUPERTYPE_STOPLIST = new Set<string>([
  "legendary", "basic", "snow", "world", "ongoing",
]);

// ── Basic land subtypes ──────────────────────────────────────────────
// Every deck has these in bulk. `sphere` was added in Edge of Eternities.
// `gate`/`urza-s` ARE valid archetypes — kept OFF the stoplist.
export const BASIC_LAND_STOPLIST = new Set<string>([
  "plains", "island", "swamp", "mountain", "forest", "wastes", "sphere",
]);

// ── Mana production ──────────────────────────────────────────────────
// Any non-spell that produces mana ends up tagged with one of these,
// which makes the keyword a coarse "this card taps for mana" signal —
// useless as a synergy theme. `produces-x` is INTENTIONALLY kept OUT:
// big-X manabases (Eldrazi Temple, Cabal Coffers) are a real archetype.
export const MANA_STOPLIST = new Set<string>([
  "produces-c", "produces-w", "produces-u",
  "produces-b", "produces-r", "produces-g",
]);

// ── Pseudo-types from oracle text negations ──────────────────────────
// These are descriptors that don't represent a card's identity ("any
// nonbasic land", "destroy target nonartifact creature"). Filter on
// sight.
export const PSEUDO_TYPE_STOPLIST = new Set<string>([
  "nonbasic", "nonland", "noncreature", "nontoken",
  "nonartifact", "nonenchantment", "nonlegendary", "nonhuman",
]);

// ── Compound type tokens ─────────────────────────────────────────────
// extractKeywords splits the type-line on hyphen/em-dash AND keeps
// pre-dash tokens. Type lines like "Legendary Creature — Human Wizard"
// produce `legendary-creature` (joined with the rule we're using), which
// is just as noisy as `creature` alone.
export const COMPOUND_TYPE_STOPLIST = new Set<string>([
  "legendary-creature", "artifact-creature", "enchantment-creature",
  "tribal-instant", "basic-land", "snow-land",
  "legendary-artifact", "legendary-enchantment", "legendary-planeswalker",
  "world-enchantment", "legendary-land", "snow-creature", "snow-artifact",
]);

// ── Generic otag namespace ───────────────────────────────────────────
// Scryfall's Tagger has a few super-broad tags that classify almost
// any card (every creature is `otag:creature`). Drop them and rely on
// the more specific tags like `otag:ramp`, `otag:landfall`, etc.
export const GENERIC_OTAG_STOPLIST = new Set<string>([
  "otag:creature", "otag:permanent", "otag:spell",
  "otag:colored", "otag:colorless", "otag:vanilla", "otag:french-vanilla",
]);

// ── Filler tribes ────────────────────────────────────────────────────
// Tribes large enough that they appear in non-tribal decks as
// incidental creature-type filler. Real tribal themes (elf, goblin,
// dragon, zombie, etc.) stay OFF the stoplist. Toggled separately from
// the common-keyword stoplist so a player building Humans tribal can
// flip exactly this on.
export const FILLER_TRIBE_STOPLIST: ReadonlySet<string> = new Set<string>([
  "human", "wizard", "warrior", "soldier", "cleric", "shaman",
]);

// Aggregate stoplist applied by default in the map.
export const COMMON_KEYWORD_STOPLIST: ReadonlySet<string> = new Set<string>([
  ...TYPE_STOPLIST,
  ...SUPERTYPE_STOPLIST,
  ...BASIC_LAND_STOPLIST,
  ...MANA_STOPLIST,
  ...PSEUDO_TYPE_STOPLIST,
  ...COMPOUND_TYPE_STOPLIST,
  ...GENERIC_OTAG_STOPLIST,
]);

export interface StoplistOptions {
  /** Apply the common-keyword stoplist (types, supertypes, basic lands,
   * mana production, pseudo-types, compound type tokens, generic otags).
   * Defaults to true; the map UI flips this when "Show common keywords"
   * is toggled on. */
  applyCommon?: boolean;
  /** Apply the filler-tribe stoplist (human, wizard, warrior, ...).
   * Defaults to true; flip off when the deck IS tribal-Human or similar. */
  applyTribes?: boolean;
}

/**
 * Build the set of keywords to exclude from frequency, tier, and edge
 * computation based on the given options. The returned set may be empty
 * if both opt-outs are passed.
 */
export function buildExcludeSet(options: StoplistOptions = {}): Set<string> {
  const applyCommon = options.applyCommon ?? true;
  const applyTribes = options.applyTribes ?? true;
  const out = new Set<string>();
  if (applyCommon) for (const k of COMMON_KEYWORD_STOPLIST) out.add(k);
  if (applyTribes) for (const k of FILLER_TRIBE_STOPLIST) out.add(k);
  return out;
}
