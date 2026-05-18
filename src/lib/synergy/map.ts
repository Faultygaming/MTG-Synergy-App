// Shared between the React component and the offline preview script.
// Pure functions — no DOM, no cytoscape — so they can be unit-tested AND
// run from a headless Node script that produces an SVG render.
//
// Mirrors the per-card classification used in src/components/SynergyMap.tsx.
// If you change either side, change both.

export interface MapCard {
  id: string;
  name: string;
  keywords: readonly string[];
}

export interface MapTop {
  primary?: string;
  secondary?: string;
  tertiary?: string;
}

export type MapTier = "gold" | "silver" | "bronze" | "none";

export const SIZE_BANDS = {
  gold:   { min: 88, max: 132 },
  silver: { min: 60, max: 80 },
  bronze: { min: 42, max: 56 },
  none:   { min: 28, max: 36 },
} as const;

// Card art_crop is roughly 4:3 landscape.
export const ART_ASPECT = 4 / 3;

export function classifyCard(
  keywords: readonly string[],
  top: MapTop,
): { tier: MapTier; shareCount: number } {
  const hasP = !!top.primary && keywords.includes(top.primary);
  const hasS = !!top.secondary && keywords.includes(top.secondary);
  const hasT = !!top.tertiary && keywords.includes(top.tertiary);
  const shareCount = (hasP ? 1 : 0) + (hasS ? 1 : 0) + (hasT ? 1 : 0);
  const tier: MapTier = hasP ? "gold" : hasS ? "silver" : hasT ? "bronze" : "none";
  return { tier, shareCount };
}

export function sizeFor(tier: MapTier, shareCount: number): number {
  const band = SIZE_BANDS[tier];
  const t = Math.min(1, shareCount / 3);
  return Math.round(band.min + (band.max - band.min) * t);
}

export function edgeTier(
  aKws: readonly string[],
  bKwsSet: Set<string>,
  top: MapTop,
): 0 | 1 | 2 | 3 | 4 {
  let best: 0 | 1 | 2 | 3 | 4 = 0;
  for (const k of aKws) {
    if (!bKwsSet.has(k)) continue;
    if (k === top.primary) return 1;
    if (k === top.secondary) {
      if (best > 2 || best === 0) best = 2;
    } else if (k === top.tertiary) {
      if (best > 3 || best === 0) best = 3;
    } else if (best === 0) {
      best = 4;
    }
  }
  return best;
}

export interface MapNode {
  id: string;
  name: string;
  tier: MapTier;
  shareCount: number;
  width: number;
  height: number;
}

export interface MapEdge {
  source: string;
  target: string;
  tier: 1 | 2 | 3 | 4;
}

export function buildMapElements(
  cards: MapCard[],
  top: MapTop,
  options: { includeTier4?: boolean } = {},
): { nodes: MapNode[]; edges: MapEdge[] } {
  const includeTier4 = options.includeTier4 ?? true;
  const nodes: MapNode[] = cards.map((c) => {
    const { tier, shareCount } = classifyCard(c.keywords, top);
    const width = sizeFor(tier, shareCount);
    return {
      id: c.id,
      name: c.name,
      tier,
      shareCount,
      width,
      height: Math.round(width / ART_ASPECT),
    };
  });
  const edges: MapEdge[] = [];
  for (let i = 0; i < cards.length; i++) {
    const a = cards[i];
    const aSet = new Set(a.keywords);
    for (let j = i + 1; j < cards.length; j++) {
      const b = cards[j];
      const t = edgeTier(b.keywords, aSet, top);
      if (t === 0) continue;
      if (t === 4 && !includeTier4) continue;
      edges.push({ source: a.id, target: b.id, tier: t });
    }
  }
  return { nodes, edges };
}
