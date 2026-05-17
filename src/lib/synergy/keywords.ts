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

// Subtypes after the em-dash in a type_line, e.g.
//   "Legendary Creature — Human Wizard" → ["human", "wizard"]
// "Creature — Goblin" → ["goblin"]
export function subtypesFromTypeLine(typeLine: string): string[] {
  // Scryfall uses either em-dash (—) or hyphen-minus depending on locale.
  const split = typeLine.split(/[—\-]/);
  if (split.length < 2) return [];
  const tail = split.slice(1).join(" ").trim();
  return tail.split(/\s+/).filter(Boolean).map(normalizeKeyword);
}

// Hand-picked regex pack. Order matters only for de-dupe (we dedupe at the end).
// Each entry yields a single normalized keyword if its regex matches.
const ORACLE_TEXT_PATTERNS: Array<{ keyword: string; pattern: RegExp }> = [
  { keyword: "etb-trigger",       pattern: /when(?:ever)?\s+[^.]*?enters(?:\s+the\s+battlefield)?/i },
  { keyword: "death-trigger",     pattern: /when(?:ever)?\s+[^.]*?dies/i },
  { keyword: "attack-trigger",    pattern: /when(?:ever)?\s+[^.]*?attacks/i },
  { keyword: "cast-trigger",      pattern: /when(?:ever)?\s+you\s+cast/i },
  { keyword: "draw",              pattern: /draw\s+(?:a|two|three|four|x)\s+cards?/i },
  { keyword: "token-maker",       pattern: /create[s]?\s+(?:a|an|one|two|three|x)\s+[^.]*?token/i },
  { keyword: "ramp",              pattern: /search your library for (?:a |an )?(?:basic )?land/i },
  { keyword: "mana-rock",         pattern: /\{T\}:\s*add(?:\s+one\s+mana|\s+\{)/i },
  { keyword: "removal-targeted",  pattern: /destroy target|exile target (creature|permanent|nonland)/i },
  { keyword: "board-wipe",        pattern: /destroy all|exile all/i },
  { keyword: "counterspell",      pattern: /counter target/i },
  { keyword: "lifegain",          pattern: /gain\s+\d+\s+life|you gain life/i },
  { keyword: "sacrifice-outlet",  pattern: /sacrifice\s+a\s+(?:creature|permanent|artifact)/i },
  { keyword: "discard",           pattern: /target (?:player|opponent) discards/i },
  { keyword: "graveyard-recursion", pattern: /return target [^.]*?(creature|permanent) card from your graveyard/i },
  { keyword: "mill",              pattern: /puts? .* cards? .* into .* graveyard|mills?/i },
  { keyword: "+1-+1-counters",    pattern: /\+1\/\+1 counter/i },
  { keyword: "proliferate",       pattern: /proliferate/i },
  { keyword: "tutor",             pattern: /search your library for a [^.]*?card/i },
  { keyword: "blink",             pattern: /exile [^.]*?then return (it|them) to the battlefield/i },
  { keyword: "extra-turn",        pattern: /take an extra turn/i },
  { keyword: "haste",             pattern: /\bhaste\b/i },
  { keyword: "indestructible",    pattern: /\bindestructible\b/i },
  { keyword: "hexproof",          pattern: /\bhexproof\b/i },
  { keyword: "flying",            pattern: /\bflying\b/i },
  { keyword: "trample",           pattern: /\btrample\b/i },
  { keyword: "deathtouch",        pattern: /\bdeathtouch\b/i },
  { keyword: "lifelink",          pattern: /\blifelink\b/i },
  { keyword: "vigilance",         pattern: /\bvigilance\b/i },
  { keyword: "menace",            pattern: /\bmenace\b/i },
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

  // 5. Regex pack over oracle text.
  const text = card.oracle_text ?? "";
  if (text) {
    for (const { keyword, pattern } of ORACLE_TEXT_PATTERNS) {
      if (pattern.test(text)) out.add(keyword);
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
