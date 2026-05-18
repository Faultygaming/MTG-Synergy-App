// Pre-canned Commander rules configurations for the playgroup vibe a
// user is targeting. The deck-page RulesConfigPanel lets a user pick a
// preset with one click; per-rule overrides remain available for fine-
// tuning.
//
// Adding a preset: append here, fill out the blurb (one short sentence),
// and ensure the config matches the desired playgroup norms. Tests in
// src/lib/commander/presets.test.ts verify the canonical configs
// pre-emptively match the active-preset detection.

import type { CommanderRulesConfig } from "./config";

export interface CommanderPreset {
  id: "strict" | "casual" | "sandbox";
  name: string;
  blurb: string;
  config: CommanderRulesConfig;
}

export const COMMANDER_PRESETS: CommanderPreset[] = [
  {
    id: "strict",
    name: "Tournament-legal",
    blurb:
      "Enforces every rule. Suggestions are strictly filtered to legal cards.",
    config: {
      deckSize: "block",
      singleton: "block",
      colorIdentity: "block",
      banlist: "block",
      commanderLegality: "block",
      globalMode: "strict",
    },
  },
  {
    id: "casual",
    name: "Casual playgroup",
    blurb:
      "Hard enforcement on size + legality; gentler on singleton, color identity, banlist.",
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
    blurb:
      "Surfaces every violation as a warning; never blocks any action. Good for testing.",
    config: {
      deckSize: "block",
      singleton: "block",
      colorIdentity: "block",
      banlist: "block",
      commanderLegality: "block",
      globalMode: "warn",
    },
  },
];

// True iff every meaningful field of two rules configs matches. Used to
// highlight the currently-active preset, if any.
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

// Tag a config with the matching preset id if any preset matches it
// byte-for-byte; otherwise return null to signal "custom".
export function detectPreset(config: CommanderRulesConfig): CommanderPreset["id"] | null {
  return COMMANDER_PRESETS.find((p) => isSamePreset(p.config, config))?.id ?? null;
}
