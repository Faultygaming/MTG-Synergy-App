// Theme model: groups related keywords into archetype clusters with
// enabler/payoff roles. The synergy engine uses this to (1) detect
// what archetypes a deck is built around, (2) recommend candidates by
// matching their role against deck composition (Crucible of Worlds
// is a PAYOFF; deck has 8 ENABLERS of graveyard-lands → strong rec),
// and (3) surface removal candidates (cards matching 0 deck themes).
//
// Why this exists separately from the regex-pack keywords:
//   - Keywords answer "what does this card do?" (mechanical tags).
//   - Themes answer "which Commander archetype does this card belong
//     to?" (gameplay role).
//   - The mapping is many-to-many: one keyword can appear in several
//     themes (e.g. `land-recursion` is both a payoff in "lands-matter"
//     AND a payoff in "graveyard-recursion"), and a theme draws from
//     many keywords.
//
// The role labels matter:
//   - `enabler`: the card CREATES the theme's resource (fetch lands
//     dump lands into graveyard; sacrifice outlets feed aristocrats).
//   - `payoff`:  the card BENEFITS from the resource (Crucible plays
//     lands from graveyard; Blood Artist triggers on each death).
//   - `neutral`: the card is associated with the theme but isn't
//     specifically enabling or paying off (a multi-color land is
//     "lands-matter" adjacent but doesn't pull either side).
//
// Curation principle: be conservative. A keyword that fits 3 themes
// is fine; a keyword that fits 8 themes is too generic — it should
// either be split or just be noise.

import type { CardSummary, DeckEntry } from "../types";

export type ThemeRole = "enabler" | "payoff" | "neutral";

export interface ThemeMember {
  keyword: string;
  role: ThemeRole;
}

export interface Theme {
  id: string;
  label: string;
  // Short, human-readable description shown in tooltips / rationale.
  description: string;
  members: ThemeMember[];
}

export const THEMES: Theme[] = [
  {
    id: "lands-matter",
    label: "Lands Matter",
    description:
      "Lands as a synergy resource — extra drops, landfall triggers, lands-as-creatures, land recursion.",
    members: [
      { keyword: "landfall", role: "payoff" },
      { keyword: "lands-matter", role: "payoff" },
      { keyword: "land-recursion", role: "payoff" },
      { keyword: "extra-land-drops", role: "enabler" },
      { keyword: "ramp", role: "enabler" },
      { keyword: "land-sacrifice", role: "enabler" },
      { keyword: "retrace", role: "payoff" },
      { keyword: "mana-fixing", role: "neutral" },
    ],
  },
  {
    id: "graveyard-recursion",
    label: "Graveyard Recursion",
    description:
      "The graveyard as a second hand — mill yourself, then return cards back as a resource.",
    members: [
      { keyword: "graveyard-recursion", role: "payoff" },
      { keyword: "reanimator", role: "payoff" },
      { keyword: "land-recursion", role: "payoff" },
      { keyword: "flashback", role: "payoff" },
      { keyword: "jump-start", role: "payoff" },
      { keyword: "escape", role: "payoff" },
      { keyword: "disturb", role: "payoff" },
      { keyword: "delirium", role: "payoff" },
      { keyword: "threshold", role: "payoff" },
      { keyword: "undergrowth", role: "payoff" },
      { keyword: "dredge", role: "enabler" },
      { keyword: "self-mill", role: "enabler" },
      { keyword: "mill", role: "enabler" },
      { keyword: "loot", role: "enabler" },
      { keyword: "rummage", role: "enabler" },
      { keyword: "discard-payoff", role: "neutral" },
      { keyword: "madness", role: "payoff" },
    ],
  },
  {
    id: "aristocrats",
    label: "Aristocrats",
    description:
      "Sacrifice your own creatures for value via death triggers and recurring threats.",
    members: [
      { keyword: "aristocrats", role: "payoff" },
      { keyword: "death-trigger", role: "payoff" },
      { keyword: "sacrifice-outlet", role: "enabler" },
      { keyword: "token-maker", role: "enabler" },
      { keyword: "reanimator", role: "enabler" },
      { keyword: "modular", role: "neutral" },
      { keyword: "persist", role: "payoff" },
      { keyword: "undying", role: "payoff" },
    ],
  },
  {
    id: "spellslinger",
    label: "Spellslinger",
    description:
      "Instants and sorceries as the engine — payoffs that trigger on each spell you cast.",
    members: [
      { keyword: "spellslinger", role: "payoff" },
      { keyword: "cast-trigger", role: "payoff" },
      { keyword: "prowess", role: "payoff" },
      { keyword: "magecraft", role: "payoff" },
      { keyword: "storm", role: "payoff" },
      { keyword: "spell-copy", role: "payoff" },
      { keyword: "x-spell", role: "payoff" },
      { keyword: "flashback", role: "neutral" },
      { keyword: "counterspell", role: "neutral" },
    ],
  },
  {
    id: "tokens",
    label: "Tokens",
    description:
      "Flood the board with token creatures — anthems and doublers as payoffs.",
    members: [
      { keyword: "token-maker", role: "enabler" },
      { keyword: "token-doubler", role: "payoff" },
      { keyword: "populate", role: "payoff" },
      { keyword: "anthem", role: "payoff" },
      { keyword: "treasure", role: "enabler" },
      { keyword: "food", role: "enabler" },
      { keyword: "clue", role: "enabler" },
      { keyword: "blood", role: "enabler" },
      { keyword: "gold-token", role: "enabler" },
      { keyword: "amass", role: "enabler" },
      { keyword: "manifest", role: "enabler" },
      { keyword: "fabricate", role: "enabler" },
    ],
  },
  {
    id: "counters",
    label: "+1/+1 Counters",
    description:
      "Grow creatures with +1/+1 counters; proliferate and doublers as payoffs.",
    members: [
      { keyword: "+1-+1-counters", role: "neutral" },
      { keyword: "counter-doubler", role: "payoff" },
      { keyword: "proliferate", role: "enabler" },
      { keyword: "modular", role: "enabler" },
      { keyword: "fabricate", role: "enabler" },
      { keyword: "amass", role: "enabler" },
      { keyword: "infect-toxic", role: "payoff" },
    ],
  },
  {
    id: "lifegain",
    label: "Lifegain",
    description: "Gain life as both trigger fuel and resource cost.",
    members: [
      { keyword: "lifegain", role: "enabler" },
      { keyword: "lifelink", role: "enabler" },
      { keyword: "lifegain-trigger", role: "payoff" },
      { keyword: "lifegain-doubler", role: "payoff" },
      { keyword: "life-as-cost", role: "payoff" },
    ],
  },
  {
    id: "voltron",
    label: "Voltron",
    description:
      "Make one big creature carry the game — equipment, auras, evasion grants.",
    members: [
      { keyword: "equipment-anchor", role: "payoff" },
      { keyword: "equipment", role: "enabler" },
      { keyword: "aura-anchor", role: "payoff" },
      { keyword: "aura", role: "enabler" },
      { keyword: "living-weapon", role: "enabler" },
      { keyword: "double-strike", role: "payoff" },
      { keyword: "trample", role: "payoff" },
      { keyword: "infect-toxic", role: "payoff" },
      { keyword: "evasion-grant", role: "enabler" },
      { keyword: "indestructible-grant", role: "enabler" },
      { keyword: "protection-grant", role: "enabler" },
      { keyword: "commander-damage", role: "payoff" },
    ],
  },
  {
    id: "stax",
    label: "Stax / Control",
    description:
      "Restrict opponents' resources; clear threats; counter their spells.",
    members: [
      { keyword: "tax-effect", role: "payoff" },
      { keyword: "stax-tap-untap", role: "payoff" },
      { keyword: "cant-attack-block", role: "payoff" },
      { keyword: "pillow-fort", role: "payoff" },
      { keyword: "counterspell", role: "payoff" },
      { keyword: "edict", role: "payoff" },
      { keyword: "board-wipe", role: "payoff" },
      { keyword: "removal-targeted", role: "payoff" },
      { keyword: "mass-artifact-removal", role: "payoff" },
      { keyword: "mass-enchantment-removal", role: "payoff" },
      { keyword: "bounce", role: "payoff" },
      { keyword: "damage-removal", role: "payoff" },
    ],
  },
  {
    id: "combo",
    label: "Combo / Wincon",
    description:
      "Alternative win conditions, extra turns, infinite-loop pieces.",
    members: [
      { keyword: "alt-win", role: "payoff" },
      { keyword: "alt-lose", role: "payoff" },
      { keyword: "extra-turn", role: "payoff" },
      { keyword: "extra-combat", role: "payoff" },
      { keyword: "tutor", role: "enabler" },
      { keyword: "mana-doubler", role: "enabler" },
      { keyword: "ritual", role: "enabler" },
      { keyword: "infect-toxic", role: "payoff" },
      { keyword: "commander-damage", role: "payoff" },
    ],
  },
  {
    id: "artifacts-matter",
    label: "Artifacts Matter",
    description: "Artifact-count payoffs, recursion, affinity-style cost reduction.",
    members: [
      { keyword: "artifacts-matter", role: "payoff" },
      { keyword: "metalcraft", role: "payoff" },
      { keyword: "affinity", role: "payoff" },
      { keyword: "improvise", role: "payoff" },
      { keyword: "mana-rock", role: "enabler" },
      { keyword: "treasure", role: "enabler" },
      { keyword: "food", role: "enabler" },
      { keyword: "clue", role: "enabler" },
      { keyword: "modular", role: "payoff" },
      { keyword: "fabricate", role: "enabler" },
    ],
  },
  {
    id: "enchantments-matter",
    label: "Enchantments Matter",
    description: "Enchantment-count payoffs, constellation, aura clusters.",
    members: [
      { keyword: "enchantments-matter", role: "payoff" },
      { keyword: "aura-anchor", role: "payoff" },
      { keyword: "aura", role: "enabler" },
      { keyword: "constellation", role: "payoff" },
    ],
  },
];

/** Summary of one theme's presence in a deck. */
export interface ThemeMatch {
  themeId: string;
  themeLabel: string;
  themeDescription: string;
  // Distinct cards (weighted by quantity for basics etc.) that touch
  // this theme in each role. A card can show up in multiple roles
  // simultaneously (Mazirek is both an enabler and payoff in aristocrats);
  // it counts once per role it satisfies.
  enablerCount: number;
  payoffCount: number;
  neutralCount: number;
  // Total distinct cards touching the theme at all.
  totalCount: number;
}

/** A candidate card's relationship to ONE of the deck's primary themes. */
export interface CandidateThemeMatch {
  themeId: string;
  themeLabel: string;
  // Best role this card plays in the theme (payoff > enabler > neutral).
  cardRole: ThemeRole;
  signal: "strong" | "moderate" | "weak";
  rationale: string;
}

// Min cards in a theme before we consider it a "primary theme" of the
// deck. 5 catches genuine archetypes without polluting on coincidence.
const THEME_PRIMARY_THRESHOLD = 5;
// A theme also has to have BOTH SIDES present — at least one enabler
// AND one payoff — otherwise it's just an incidental cluster. A deck
// with 12 token-makers but zero token payoffs (anthems, populate,
// doublers) isn't running a tokens strategy — those token-makers are
// landfall-incidental.
const REQUIRE_ROLE_BALANCE = true;

/**
 * Walk the deck and return each theme that's a "primary" archetype
 * (has at least THEME_PRIMARY_THRESHOLD member cards), sorted by
 * total contribution.
 */
export function detectDeckThemes(entries: DeckEntry[]): ThemeMatch[] {
  const matches: ThemeMatch[] = [];
  for (const theme of THEMES) {
    let enablerCount = 0;
    let payoffCount = 0;
    let neutralCount = 0;
    const memberLookup = new Map<string, ThemeRole>();
    for (const m of theme.members) memberLookup.set(m.keyword, m.role);

    for (const entry of entries) {
      let isEnabler = false;
      let isPayoff = false;
      let isNeutral = false;
      for (const k of entry.card.keywords) {
        const role = memberLookup.get(k);
        if (!role) continue;
        if (role === "enabler") isEnabler = true;
        else if (role === "payoff") isPayoff = true;
        else isNeutral = true;
      }
      if (isEnabler) enablerCount += entry.quantity;
      if (isPayoff) payoffCount += entry.quantity;
      if (isNeutral) neutralCount += entry.quantity;
    }
    const totalCount = enablerCount + payoffCount + neutralCount;
    const passesThreshold = totalCount >= THEME_PRIMARY_THRESHOLD;
    const passesRoleBalance =
      !REQUIRE_ROLE_BALANCE ||
      (enablerCount >= 1 && payoffCount >= 1);
    if (passesThreshold && passesRoleBalance) {
      matches.push({
        themeId: theme.id,
        themeLabel: theme.label,
        themeDescription: theme.description,
        enablerCount,
        payoffCount,
        neutralCount,
        totalCount,
      });
    }
  }
  return matches.sort((a, b) => b.totalCount - a.totalCount);
}

/**
 * For a candidate card, return its relationship to each deck primary
 * theme. The "signal" field captures the recommendation strength:
 *   - strong  : closes a gap (payoff for a deck heavy on enablers, or
 *               vice versa).
 *   - moderate: reinforces an already-balanced theme.
 *   - weak    : marginal touch (only via a neutral keyword).
 */
export function scoreCandidateByThemes(
  candidate: CardSummary,
  deckThemes: ThemeMatch[],
): CandidateThemeMatch[] {
  const out: CandidateThemeMatch[] = [];
  const candidateKws = new Set(candidate.keywords);

  for (const dt of deckThemes) {
    const theme = THEMES.find((t) => t.id === dt.themeId);
    if (!theme) continue;

    // Best role the candidate plays in this theme (prefer payoff > enabler > neutral).
    let cardRole: ThemeRole | null = null;
    for (const m of theme.members) {
      if (!candidateKws.has(m.keyword)) continue;
      if (m.role === "payoff") {
        cardRole = "payoff";
        break; // can't beat payoff
      }
      if (m.role === "enabler") cardRole = "enabler";
      else if (m.role === "neutral" && !cardRole) cardRole = "neutral";
    }
    if (!cardRole) continue;

    let signal: "strong" | "moderate" | "weak";
    let rationale: string;

    // STRONG paths (any of these qualifies):
    //   (a) closes-the-loop: candidate fills the lighter side of an
    //       unbalanced theme (≥5 on one side, <3 on the other).
    //   (b) heavy archetype: theme has 20+ contributing cards AND
    //       candidate is a payoff. A 60-card "lands matter" theme is
    //       the defining archetype of the deck — Crucible of Worlds is
    //       a high-impact addition whether or not the enabler/payoff
    //       balance is already even.
    if (cardRole === "payoff" && dt.enablerCount >= 5 && dt.payoffCount < 3) {
      signal = "strong";
      rationale = `Your deck has ${dt.enablerCount} ${dt.themeLabel.toLowerCase()} enablers but only ${dt.payoffCount} payoff${dt.payoffCount === 1 ? "" : "s"} — this is the kind of card that closes the loop.`;
    } else if (
      cardRole === "enabler" &&
      dt.payoffCount >= 5 &&
      dt.enablerCount < 3
    ) {
      signal = "strong";
      rationale = `Your deck has ${dt.payoffCount} ${dt.themeLabel.toLowerCase()} payoffs but only ${dt.enablerCount} enabler${dt.enablerCount === 1 ? "" : "s"} — this fuels them.`;
    } else if (cardRole === "payoff" && dt.totalCount >= 20) {
      signal = "strong";
      rationale = `Your deck is built around ${dt.themeLabel.toLowerCase()} (${dt.totalCount} cards) — this is a high-impact payoff.`;
    } else if (cardRole === "neutral") {
      signal = "weak";
      rationale = `Touches the ${dt.themeLabel.toLowerCase()} theme.`;
    } else {
      signal = "moderate";
      rationale = `Adds to your ${dt.totalCount}-card ${dt.themeLabel.toLowerCase()} theme.`;
    }

    out.push({
      themeId: theme.id,
      themeLabel: theme.label,
      cardRole,
      signal,
      rationale,
    });
  }

  return out;
}

/**
 * Map theme matches → gold/silver/bronze tier:
 *   - gold   : at least one STRONG signal (closes-the-loop card)
 *   - silver : MODERATE signal in 2+ deck themes (broadly synergistic)
 *   - bronze : MODERATE signal in 1 theme, OR weak-only matches
 *   - null   : no theme touches
 */
export function themeTier(
  matches: CandidateThemeMatch[],
): "gold" | "silver" | "bronze" | null {
  if (matches.length === 0) return null;
  if (matches.some((m) => m.signal === "strong")) return "gold";
  const moderate = matches.filter((m) => m.signal === "moderate").length;
  if (moderate >= 2) return "silver";
  if (moderate === 1) return "bronze";
  return "bronze"; // weak-only matches
}

/**
 * For each deck card, count how many of the deck's primary themes it
 * participates in. Sorted ascending — lowest scores are removal
 * candidates ("doesn't pull its weight").
 */
export function scoreDeckCardsForRemoval(
  entries: DeckEntry[],
  deckThemes: ThemeMatch[],
): Array<{ card: CardSummary; themesMatched: number; matchedLabels: string[] }> {
  // Pre-build keyword → theme-ids lookup.
  const keywordToThemes = new Map<string, string[]>();
  for (const theme of THEMES) {
    if (!deckThemes.some((dt) => dt.themeId === theme.id)) continue;
    for (const m of theme.members) {
      const arr = keywordToThemes.get(m.keyword) ?? [];
      arr.push(theme.id);
      keywordToThemes.set(m.keyword, arr);
    }
  }

  const out = entries.map((e) => {
    const themesHit = new Set<string>();
    for (const k of e.card.keywords) {
      const themes = keywordToThemes.get(k);
      if (themes) for (const id of themes) themesHit.add(id);
    }
    const matchedLabels = Array.from(themesHit).map(
      (id) => deckThemes.find((dt) => dt.themeId === id)?.themeLabel ?? id,
    );
    return {
      card: e.card,
      themesMatched: themesHit.size,
      matchedLabels,
    };
  });

  return out.sort(
    (a, b) =>
      a.themesMatched - b.themesMatched ||
      a.card.name.localeCompare(b.card.name),
  );
}
