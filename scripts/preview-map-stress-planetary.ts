/**
 * Planetary-layout variant of preview-map-stress. Same 99-card
 * synthetic deck rendered through packPlanetary so the SVG dev loop
 * can validate that layout too.
 *
 *   pnpm tsx scripts/preview-map-stress-planetary.ts
 *
 * Output: data/map-preview-stress-planetary.svg
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildMapElements,
  packPlanetary,
  type MapCard,
  type MapTier,
} from "../src/lib/synergy/map";
import { COMMON_KEYWORD_STOPLIST } from "../src/lib/synergy/stoplist";

function syntheticDeck(): MapCard[] {
  const cards: MapCard[] = [];
  for (let i = 0; i < 35; i++) {
    const extras = i < 6 ? ["produces-g"] : i < 12 ? ["produces-r"] : i < 16 ? ["produces-b"] : [];
    cards.push({
      id: `land-${i}`,
      name: i < 8 ? "Forest" : i < 13 ? "Mountain" : i < 18 ? "Swamp" : `Land ${i}`,
      keywords: ["land", ...extras],
    });
  }
  const landfalls = [
    "Lord Windgrace", "Omnath, Locus of Rage", "Rampaging Baloths",
    "Tireless Tracker", "Multani, Yavimaya's Avatar",
    "Ramunap Excavator", "Centaur Vinecrasher", "World Breaker",
    "Augur of Autumn", "Oracle of Mul Daya", "Splendid Reclamation",
    "Scute Swarm", "Titania, Protector of Argoth", "The Gitrog Monster",
    "Aftermath Analyst", "Roiling Regrowth", "Worldsoul's Rage",
    "Hearthhull, the Worldseed",
  ];
  for (const name of landfalls) cards.push({ id: name, name, keywords: ["creature", "landfall"] });
  const recursion = [
    "Life from the Loam", "Splendid Reclamation 2", "Eternal Witness",
    "Soul of Windgrace", "Gaze of Granite", "Putrefy",
    "Cultivate", "Harrow", "Rampant Growth", "Springbloom Druid",
    "Skyshroud Claim", "Nature's Lore",
  ];
  for (const name of recursion) cards.push({ id: name, name, keywords: ["sorcery", "graveyard-recursion"] });
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
  for (const name of rest) cards.push({ id: name, name, keywords: ["artifact"] });
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function main() {
  const cards = syntheticDeck();
  const top = { primary: "land", secondary: "landfall", tertiary: "graveyard-recursion" };
  const { nodes } = buildMapElements(cards, top, {
    includeTier4: false,
    excludeKeywords: COMMON_KEYWORD_STOPLIST,
    minClusterSize: 3,
  });
  const packed = packPlanetary(
    nodes.map((n, i) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      tier: n.tier,
      shareCount: n.shareCount,
      keywords: cards[i].keywords.filter((k) => !COMMON_KEYWORD_STOPLIST.has(k)),
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

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, sans-serif">
  <rect width="100%" height="100%" fill="#0e0e10"/>
  <g>`;
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
    <text x="20" y="${H - 42}" font-weight="600">PLANETARY · synthetic Hearthhull-shaped deck</text>
    <text x="20" y="${H - 24}" font-size="11" fill="#a1a1aa">Anchor cards on outer ring; moons orbit by shared-keyword affinity.</text>
  </g>
</svg>`;
  const outDir = resolve(process.cwd(), "data");
  mkdirSync(outDir, { recursive: true });
  const out = resolve(outDir, "map-preview-stress-planetary.svg");
  writeFileSync(out, svg, "utf8");
  console.log(`Wrote ${out}  (${W}×${H} px, ${nodes.length} nodes)`);
}

main();
