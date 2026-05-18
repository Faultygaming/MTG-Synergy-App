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

// ── Pie-sector cloud layout ──────────────────────────────────────────
//
// Force-directed layouts (cose/cose-bilkent) can't avoid node overlap
// when many cards share one keyword (e.g. 30+ lands all connecting via
// "land"). They pull everything into one cluster and nodes settle on
// top of each other.
//
// `packPieCloud` skips the physics entirely. The map becomes one
// continuous disk, divided into pie sectors:
//
//   gold   = cards matching the deck's primary keyword
//   silver = cards matching secondary (but not primary)
//   bronze = cards matching tertiary (but neither primary nor secondary)
//   none   = cards with no top-3 keyword match
//
// Each sector's angular width is proportional to its card count, so a
// land-heavy deck visibly has a big gold wedge. Within a sector cards
// are laid out on concentric rings from the inner radius outward, with
// the highest-shareCount cards on the innermost ring.
//
// Result: a single circular cloud where the angular position encodes
// "which deck axis does this card serve" and the radial position
// encodes "how prominent is this card within that axis". No overlap
// is structurally possible — the algorithm only places cards where
// the arc has room for them.

export interface PackInput {
  id: string;
  width: number;
  height: number;
  tier: MapTier;
  shareCount: number;
}

export interface PackPosition {
  id: string;
  x: number;
  y: number;
}

const TIER_PRIORITY: Record<MapTier, number> = {
  gold: 3,
  silver: 2,
  bronze: 1,
  none: 0,
};

export interface PackOptions {
  /** Gap between adjacent cards on the same ring, in pixels. */
  padding?: number;
  /** Inner radius — the empty hole at the center. */
  innerRadius?: number;
  /** Gap between concentric rings, in pixels. */
  ringGap?: number;
}

export function packPieCloud(
  nodes: PackInput[],
  options: PackOptions = {},
): PackPosition[] {
  const padding = options.padding ?? 14;
  const innerRadius = options.innerRadius ?? 60;
  const ringGap = options.ringGap ?? 10;

  if (nodes.length === 0) return [];

  // Group by tier so each sector contains only one tier's worth of cards.
  const tiers: MapTier[] = ["gold", "silver", "bronze", "none"];
  const grouped = new Map<MapTier, PackInput[]>();
  for (const t of tiers) grouped.set(t, []);
  for (const n of nodes) grouped.get(n.tier)!.push(n);

  // Within each tier, biggest cards (more top-3 matches) on inner ring.
  for (const t of tiers) {
    grouped.get(t)!.sort((a, b) => b.shareCount - a.shareCount || b.width - a.width);
  }

  // Sector angles: proportional to card count. Tiers with zero cards
  // get no sector (skipped) so a deck without any silver matches just
  // moves bronze/none into the saved angular space.
  const total = nodes.length;
  let cumulative = 0;
  const sectors: Array<{
    tier: MapTier;
    cards: PackInput[];
    startAngle: number;
    endAngle: number;
  }> = [];
  // Iterate tiers in priority order so the gold sector starts at 0°
  // (12 o'clock, after the rotation in the renderer) and the remaining
  // tiers fill clockwise — predictable layout for the viewer.
  for (const t of tiers) {
    const cards = grouped.get(t)!;
    if (cards.length === 0) continue;
    const start = (cumulative / total) * Math.PI * 2;
    cumulative += cards.length;
    const end = (cumulative / total) * Math.PI * 2;
    sectors.push({ tier: t, cards, startAngle: start, endAngle: end });
  }

  // Global overlap check: we verify each candidate position against
  // EVERY previously-placed card (across all sectors). That catches
  // cross-sector collisions at the inner radius and lets us fall back
  // to the next angular slot or ring if a position is taken.
  interface PlacedRect { x: number; y: number; hw: number; hh: number }
  const placed: PlacedRect[] = [];
  function overlapsPlaced(
    x: number,
    y: number,
    cardW: number,
    cardH: number,
  ): boolean {
    const hw = cardW / 2 + padding / 2;
    const hh = cardH / 2 + padding / 2;
    for (const p of placed) {
      if (Math.abs(x - p.x) < hw + p.hw && Math.abs(y - p.y) < hh + p.hh) {
        return true;
      }
    }
    return false;
  }

  const positions: PackPosition[] = [];
  for (const sector of sectors) {
    const sectorWidth = sector.endAngle - sector.startAngle;
    let r = innerRadius;
    let i = 0;
    let slot = 0;
    let slotsOnRing = 1;
    let safety = 5000;

    while (i < sector.cards.length && safety-- > 0) {
      const c = sector.cards[i];
      const cardSize = Math.max(c.width, c.height) + padding;
      // Chord-based capacity: cards laid out on a ring of radius r within
      // an arc of `sectorWidth` rad. The chord distance between adjacent
      // cards at angular separation Δθ is 2r·sin(Δθ/2); we need that
      // ≥ cardSize. So Δθ ≥ 2·asin(cardSize / 2r), and the slot count is
      // floor(sectorWidth / Δθ). If a card is wider than the ring's
      // diameter (cardSize > 2r), no slots fit; we bump the radius.
      if (cardSize >= 2 * r) {
        // ring too tight for this card — escalate to a wider ring
        r += cardSize / 2 + ringGap;
        slot = 0;
        continue;
      }
      const minDeltaTheta = 2 * Math.asin(cardSize / (2 * r));
      slotsOnRing = Math.max(1, Math.floor(sectorWidth / minDeltaTheta));

      // Try the current slot. If it's taken by a prior placement
      // (typically a cross-sector neighbor at low radius), advance the
      // slot pointer; when slots run out, bump the ring outward.
      const theta =
        sector.startAngle + ((slot + 0.5) / slotsOnRing) * sectorWidth;
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      if (!overlapsPlaced(x, y, c.width, c.height)) {
        placed.push({
          x,
          y,
          hw: c.width / 2 + padding / 2,
          hh: c.height / 2 + padding / 2,
        });
        positions.push({ id: c.id, x, y });
        i += 1;
        slot += 1;
      } else {
        slot += 1;
      }

      // Ring exhausted — step radius outward by the ring's worst case.
      if (slot >= slotsOnRing) {
        r += cardSize + ringGap;
        slot = 0;
      }
    }
  }

  return positions;
}

// Backwards-compatible alias kept while callers transition; this is the
// public name a future caller should use.
export const packCloud = packPieCloud;

export interface BuildMapOptions {
  /** Skip tier-4 (any non-top-3 shared keyword) edges entirely. */
  includeTier4?: boolean;
  /** Keywords to ignore for edge derivation (stoplist filter). Tier-1/2/3
   * are unaffected because they come from `top` directly. */
  excludeKeywords?: ReadonlySet<string>;
  /** Minimum number of deck cards that must share a keyword before any
   * edge it contributes is drawn. Default 3 (smallest non-trivial
   * cluster — see CLAUDE.md / stoplist research notes). Set to 0 to
   * disable. Only applies to TIER-4 edges; the top-3 keywords backing
   * gold/silver/bronze tiers always render their edges. */
  minClusterSize?: number;
}

export function buildMapElements(
  cards: MapCard[],
  top: MapTop,
  options: BuildMapOptions = {},
): { nodes: MapNode[]; edges: MapEdge[] } {
  const includeTier4 = options.includeTier4 ?? true;
  const excludeKeywords = options.excludeKeywords;
  const minClusterSize = options.minClusterSize ?? 3;

  // Count how many deck cards carry each keyword, ignoring excluded ones.
  // Used to suppress tier-4 edges whose underlying keyword is "rare"
  // (appears on fewer than minClusterSize cards) — that edge represents
  // an isolated pair, not a theme.
  const keywordCounts = new Map<string, number>();
  for (const c of cards) {
    for (const k of c.keywords) {
      if (excludeKeywords?.has(k)) continue;
      keywordCounts.set(k, (keywordCounts.get(k) ?? 0) + 1);
    }
  }

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
    // Keyword set without excluded entries, so edgeTier never returns
    // tier 4 for a stoplisted shared keyword.
    const aSet = new Set(
      excludeKeywords ? a.keywords.filter((k) => !excludeKeywords.has(k)) : a.keywords,
    );
    for (let j = i + 1; j < cards.length; j++) {
      const b = cards[j];
      const bFiltered = excludeKeywords
        ? b.keywords.filter((k) => !excludeKeywords.has(k))
        : b.keywords;
      const t = edgeTier(bFiltered, aSet, top);
      if (t === 0) continue;
      if (t === 4 && !includeTier4) continue;
      // Tier-4 only: drop edges whose strongest underlying shared
      // keyword is "rare". Find the most-common keyword shared by both
      // cards; if it appears on fewer than minClusterSize cards in the
      // deck, skip the edge.
      if (t === 4 && minClusterSize > 1) {
        let bestCount = 0;
        for (const k of bFiltered) {
          if (!aSet.has(k)) continue;
          const c = keywordCounts.get(k) ?? 0;
          if (c > bestCount) bestCount = c;
        }
        if (bestCount < minClusterSize) continue;
      }
      edges.push({ source: a.id, target: b.id, tier: t });
    }
  }
  return { nodes, edges };
}
