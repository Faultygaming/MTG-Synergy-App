/**
 * Stress preview: renders the SAME pie-sector packing algorithm against a
 * synthetic 99-card deck shaped like a typical Hearthhull / land-heavy
 * commander build. No DB or Scryfall calls — purely synthetic so I can
 * validate the layout from a sandbox without ingest data.
 *
 * Output: data/map-preview-stress.svg (gitignored).
 *
 * Usage:  pnpm tsx scripts/preview-map-stress.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildMapElements,
  packPieCloud,
  subgroupKeyFor,
  type MapCard,
  type MapTier,
} from "../src/lib/synergy/map";
import { COMMON_KEYWORD_STOPLIST } from "../src/lib/synergy/stoplist";

// Build a synthetic deck approximating the Hearthhull / World Shaper
// distribution: heavy on lands + landfall payoffs.
function syntheticDeck(): MapCard[] {
  const cards: MapCard[] = [];
  // 35 lands — all share "land" as primary keyword
  for (let i = 0; i < 35; i++) {
    const extras = i < 6 ? ["produces-g"] : i < 12 ? ["produces-r"] : i < 16 ? ["produces-b"] : [];
    cards.push({
      id: `land-${i}`,
      name: i < 8 ? "Forest" : i < 13 ? "Mountain" : i < 18 ? "Swamp" : `Land ${i}`,
      keywords: ["land", ...extras],
    });
  }
  // 18 lands-matter / landfall payoffs — silver (matches "landfall")
  const landfalls = [
    "Lord Windgrace", "Omnath, Locus of Rage", "Rampaging Baloths",
    "Tireless Tracker", "Multani, Yavimaya's Avatar",
    "Ramunap Excavator", "Centaur Vinecrasher", "World Breaker",
    "Augur of Autumn", "Oracle of Mul Daya", "Splendid Reclamation",
    "Scute Swarm", "Titania, Protector of Argoth", "The Gitrog Monster",
    "Aftermath Analyst", "Roiling Regrowth", "Worldsoul's Rage",
    "Hearthhull, the Worldseed",
  ];
  for (const name of landfalls) {
    cards.push({ id: name, name, keywords: ["creature", "landfall"] });
  }
  // 12 ramp/recursion — bronze (matches "graveyard-recursion")
  const recursion = [
    "Life from the Loam", "Splendid Reclamation 2", "Eternal Witness",
    "Soul of Windgrace", "Gaze of Granite", "Putrefy",
    "Cultivate", "Harrow", "Rampant Growth", "Springbloom Druid",
    "Skyshroud Claim", "Nature's Lore",
  ];
  for (const name of recursion) {
    cards.push({ id: name, name, keywords: ["sorcery", "graveyard-recursion"] });
  }
  // 34 untiered (creatures, instants, artifacts not matching any top-3)
  const rest = [
    "Sol Ring", "Arcane Signet", "Command Tower", "Beast Within",
    "Infernal Grasp", "Tear Asunder", "Blasphemous Act", "Rakdos Charm",
    "Windgrace's Judgment", "Binding the Old Gods", "Night's Whisper",
    "Korvold, Fae-Cursed King", "Juri, Master of the Revue", "Mayhem Devil",
    "God-Eternal Bontu", "Braids, Arisen Nightmare", "Mazirek",
    "Moraug, Fury of Akoum", "Formless Genesis", "Loamcrafter Faun",
    "Sprouting Goblin", "Groundskeeper", "Pest Infestation", "Scouring Swarm",
    "Hammer of Purphoros", "Planetary Annihilation", "Exploration Broodship",
    "Evendo Brushrazer", "Baloth Prime", "Eumidian Wastewaker",
    "Szarel", "Eumidian Hatchery", "Festering Thicket", "Cabaretti Courtyard",
  ];
  for (const name of rest) {
    cards.push({ id: name, name, keywords: ["artifact"] });
  }
  return cards;
}

const TIER_BORDER: Record<MapTier, string> = {
  gold: "#d4af37", silver: "#c0c0c0", bronze: "#cd7f32", none: "#2a2a30",
};
const TIER_LABEL_COLOR: Record<MapTier, string> = {
  gold: "#fde68a", silver: "#e7e5e4", bronze: "#d6a373", none: "#71717a",
};
const TIER_LABEL_SIZE: Record<MapTier, number> = {
  gold: 13, silver: 11, bronze: 10, none: 8,
};
const EDGE_WIDTH = { 1: 3.0, 2: 2.0, 3: 1.2, 4: 0.4 } as const;
const EDGE_OPACITY = { 1: 0.7, 2: 0.45, 3: 0.3, 4: 0.08 } as const;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function main() {
  const cards = syntheticDeck();
  const top = { primary: "land", secondary: "landfall", tertiary: "graveyard-recursion" };
  const { nodes, edges } = buildMapElements(cards, top, {
    includeTier4: true,
    excludeKeywords: COMMON_KEYWORD_STOPLIST,
    minClusterSize: 3,
  });
  // Compute per-keyword counts on the synthetic deck so the subgroup
  // selection matches what the React component would do.
  const counts = new Map<string, number>();
  for (const c of cards) {
    for (const k of c.keywords) {
      if (COMMON_KEYWORD_STOPLIST.has(k)) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const packed = packPieCloud(
    nodes.map((n, i) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      tier: n.tier,
      shareCount: n.shareCount,
      subgroup: subgroupKeyFor(
        cards[i].keywords,
        top,
        COMMON_KEYWORD_STOPLIST,
        counts,
      ),
    })),
  );
  const positions = packed.map((p) => {
    const node = nodes.find((n) => n.id === p.id)!;
    return { node, x: p.x, y: p.y };
  });

  const bb = positions.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x - p.node.width / 2),
      minY: Math.min(acc.minY, p.y - p.node.height / 2),
      maxX: Math.max(acc.maxX, p.x + p.node.width / 2),
      maxY: Math.max(acc.maxY, p.y + p.node.height / 2),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const pad = 40;
  const W = Math.ceil(bb.maxX - bb.minX + pad * 2);
  const H = Math.ceil(bb.maxY - bb.minY + pad * 2);
  const tx = (x: number) => x - bb.minX + pad;
  const ty = (y: number) => y - bb.minY + pad;

  const tierCounts: Record<MapTier, number> = { gold: 0, silver: 0, bronze: 0, none: 0 };
  for (const n of nodes) tierCounts[n.tier] += 1;
  const edgeCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const e of edges) edgeCounts[e.tier] += 1;
  const positionById = new Map(positions.map((p) => [p.node.id, p]));

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, sans-serif">
  <rect width="100%" height="100%" fill="#0e0e10"/>
  <g stroke="#5eead4" fill="none">`;
  for (const e of edges) {
    const a = positionById.get(e.source);
    const b = positionById.get(e.target);
    if (!a || !b) continue;
    svg += `\n    <line x1="${tx(a.x).toFixed(1)}" y1="${ty(a.y).toFixed(1)}" x2="${tx(b.x).toFixed(1)}" y2="${ty(b.y).toFixed(1)}" stroke-width="${EDGE_WIDTH[e.tier]}" stroke-opacity="${EDGE_OPACITY[e.tier]}"/>`;
  }
  svg += `\n  </g>\n  <g>`;
  for (const p of positions) {
    const { node, x, y } = p;
    const ax = tx(x) - node.width / 2;
    const ay = ty(y) - node.height / 2;
    svg += `\n    <rect x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" width="${node.width}" height="${node.height}" fill="#1a1a1d" stroke="${TIER_BORDER[node.tier]}" stroke-width="${node.tier === "gold" ? 3 : node.tier === "none" ? 1 : 2}" rx="4"/>
    <text x="${tx(x).toFixed(1)}" y="${(ay + node.height + TIER_LABEL_SIZE[node.tier] + 4).toFixed(1)}" text-anchor="middle" fill="${TIER_LABEL_COLOR[node.tier]}" font-size="${TIER_LABEL_SIZE[node.tier]}" font-weight="${node.tier === "gold" ? 600 : 400}">${escapeXml(node.name)}</text>`;
  }
  svg += `
  </g>
  <g font-size="13" fill="#e7e5e4">
    <text x="20" y="${H - 60}" font-weight="600">stress: synthetic Hearthhull-shaped deck</text>
    <text x="20" y="${H - 42}" font-size="11" fill="#a1a1aa">${cards.length} cards · primary land · secondary landfall · tertiary graveyard-recursion</text>
    <text x="20" y="${H - 24}" font-size="11" fill="#a1a1aa">tiers: gold ${tierCounts.gold} / silver ${tierCounts.silver} / bronze ${tierCounts.bronze} / none ${tierCounts.none}  ·  edges T1:${edgeCounts[1]} T2:${edgeCounts[2]} T3:${edgeCounts[3]} T4:${edgeCounts[4]}  ·  ${W}×${H}px</text>
  </g>
</svg>`;

  const outDir = resolve(process.cwd(), "data");
  mkdirSync(outDir, { recursive: true });
  const out = resolve(outDir, "map-preview-stress.svg");
  writeFileSync(out, svg, "utf8");
  console.log(`Wrote ${out}  (${W}×${H} px, ${nodes.length} nodes, ${edges.length} edges)`);
  console.log(`tiers: gold ${tierCounts.gold}, silver ${tierCounts.silver}, bronze ${tierCounts.bronze}, none ${tierCounts.none}`);
}

main();
