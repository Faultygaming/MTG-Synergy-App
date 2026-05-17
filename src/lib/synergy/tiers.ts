// UI bindings for tier visuals. Kept separate from the scoring core so the
// algorithm has no UI deps and is easy to unit-test.

import type { Tier } from "../types";

export const TIER_LABEL: Record<Tier, string> = {
  gold: "Primary",
  silver: "Secondary",
  bronze: "Tertiary",
};

// Tailwind classes for the card frame border. Untiered cards get a neutral ring.
export const TIER_RING_CLASS: Record<Tier | "none", string> = {
  gold: "shadow-tier-gold ring-1 ring-tier-gold/60",
  silver: "shadow-tier-silver ring-1 ring-tier-silver/60",
  bronze: "shadow-tier-bronze ring-1 ring-tier-bronze/60",
  none: "ring-1 ring-ink-line",
};

export const TIER_BADGE_CLASS: Record<Tier, string> = {
  gold: "bg-tier-gold text-ink",
  silver: "bg-tier-silver text-ink",
  bronze: "bg-tier-bronze text-ink",
};
