// Shared definitions for the rules-settings playground variants. Each
// variant component imports these so the underlying data and copy stay
// consistent — only the presentation differs.

import type { CommanderRulesConfig } from "@/lib/commander/rules";

export type RuleKey = keyof Omit<CommanderRulesConfig, "globalMode">;

export interface RuleMeta {
  key: RuleKey;
  label: string;
  hint: string;
  /** A longer, "why this matters" description used by the variants that
   * have room for it. */
  long: string;
  /** Example phrasing of what a violation looks like at each severity. */
  exampleAtBlock: string;
  exampleAtWarn: string;
}

export const RULES: RuleMeta[] = [
  {
    key: "commanderLegality",
    label: "Commander legality",
    hint: "Legendary type + eligibility (creature / vehicle / spacecraft / PW)",
    long: "The commander must be a legendary creature, legendary vehicle, legendary spacecraft, or any card whose text says it can be your commander. Partner / Background / Friends Forever pairings unlock a second commander.",
    exampleAtBlock: "Refuses to save: 'Llanowar Elves can't be a commander: not legendary.'",
    exampleAtWarn: "Saves the deck but flags an amber warning on the page.",
  },
  {
    key: "deckSize",
    label: "Deck size (100)",
    hint: "Total must equal 100 (commander + 99)",
    long: "Standard Commander requires exactly 100 cards including the commander. Some house rules play smaller or larger.",
    exampleAtBlock: "Refuses to save: 'Deck must be exactly 100 cards (has 99).'",
    exampleAtWarn: "Saves but warns about deck size.",
  },
  {
    key: "singleton",
    label: "Singleton",
    hint: "1 of each non-basic, except 'any number of' cards",
    long: "Each non-basic card may appear at most once, with hard-coded exceptions for cards whose oracle text grants 'a deck can have any number of cards named ___' (Relentless Rats, Shadowborn Apostle, Dragon's Approach, etc.).",
    exampleAtBlock: "Refuses 4x Lightning Bolt in a deck without a Rat-style exception.",
    exampleAtWarn: "Allows duplicates but flags them.",
  },
  {
    key: "colorIdentity",
    label: "Color identity",
    hint: "Every card's CI ⊆ commander CI",
    long: "Each card's color identity (mana symbols anywhere in cost AND rules text) must fit inside the combined commander color identity. Hybrid mana counts as both colors.",
    exampleAtBlock: "Refuses Lightning Bolt in a mono-green deck (R ⊄ G).",
    exampleAtWarn: "Allows but flags off-color cards; suggestions still filter.",
  },
  {
    key: "banlist",
    label: "Banlist",
    hint: "Commander RC banned cards",
    long: "Cards on the Commander Format Panel banned list (mirrored from mtgcommander.net). Snapshot refreshed Feb 9, 2026. House rules can ignore this.",
    exampleAtBlock: "Refuses Black Lotus / Mana Crypt / Jeweled Lotus / etc.",
    exampleAtWarn: "Allows banned cards but flags them prominently.",
  },
];

export const DEFAULT_CONFIG: CommanderRulesConfig = {
  deckSize: "block",
  singleton: "block",
  colorIdentity: "block",
  banlist: "block",
  commanderLegality: "block",
  globalMode: "strict",
};

export const PRESETS: Array<{
  id: string;
  name: string;
  blurb: string;
  config: CommanderRulesConfig;
}> = [
  {
    id: "strict",
    name: "Tournament-legal",
    blurb: "Enforces every rule; suggestions strictly filtered to legal cards.",
    config: { ...DEFAULT_CONFIG, globalMode: "strict" },
  },
  {
    id: "casual",
    name: "Casual playgroup",
    blurb: "Hard enforcement on size & legality; gentler on the rest.",
    config: {
      deckSize: "block",
      commanderLegality: "block",
      singleton: "warn",
      colorIdentity: "warn",
      banlist: "warn",
      globalMode: "strict",
    },
  },
  {
    id: "sandbox",
    name: "Sandbox / proxy",
    blurb: "Surfaces violations as warnings; never blocks any action.",
    config: { ...DEFAULT_CONFIG, globalMode: "warn" },
  },
];

export function isSamePreset(
  a: CommanderRulesConfig,
  b: CommanderRulesConfig,
): boolean {
  const keys: Array<keyof CommanderRulesConfig> = [
    "deckSize",
    "singleton",
    "colorIdentity",
    "banlist",
    "commanderLegality",
    "globalMode",
  ];
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}
