/**
 * Headless preview of the synergy map: runs the SAME element-building and
 * cose-bilkent layout that the React component uses, then writes an SVG
 * to data/map-preview.svg that mirrors what the user will see in the
 * browser.
 *
 * Why: lets me (Claude or any contributor working from a sandbox without
 * a real browser) self-validate visual changes to SynergyMap.tsx before
 * pushing. No Scryfall calls, no DB writes — pure rendering math against
 * whatever's currently in the local SQLite via Prisma.
 *
 * Usage:
 *   pnpm tsx scripts/preview-map.ts <deck-id>
 *
 * Output: data/map-preview.svg (gitignored). Open in any browser or
 * `Read` it as text from this sandbox.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import {
  buildMapElements,
  packPieCloud,
  type MapTier,
} from "../src/lib/synergy/map";
import {
  keywordFrequency,
  topThreeKeywords,
} from "../src/lib/synergy/score";
import { COMMON_KEYWORD_STOPLIST } from "../src/lib/synergy/stoplist";
import type { DeckEntry } from "../src/lib/types";

const TIER_BORDER: Record<MapTier, string> = {
  gold: "#d4af37",
  silver: "#c0c0c0",
  bronze: "#cd7f32",
  none: "#2a2a30",
};
const TIER_LABEL_COLOR: Record<MapTier, string> = {
  gold: "#fde68a",
  silver: "#e7e5e4",
  bronze: "#d6a373",
  none: "#71717a",
};
const TIER_LABEL_SIZE: Record<MapTier, number> = {
  gold: 13,
  silver: 11,
  bronze: 10,
  none: 8,
};
const EDGE_WIDTH = { 1: 3.0, 2: 2.0, 3: 1.2, 4: 0.4 } as const;
const EDGE_OPACITY = { 1: 0.7, 2: 0.45, 3: 0.3, 4: 0.08 } as const;

async function main() {
  const deckId = process.argv[2];
  if (!deckId) {
    console.error("usage: pnpm tsx scripts/preview-map.ts <deck-id>");
    process.exit(2);
  }
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: { cards: { include: { card: true } } },
  });
  if (!deck) {
    console.error(`No deck with id=${deckId}`);
    process.exit(1);
  }
  console.log(`Deck: ${deck.name}  (${deck.cards.length} cards)`);

  const entries: DeckEntry[] = deck.cards.map((dc) => ({
    card: {
      id: dc.card.id,
      name: dc.card.name,
      typeLine: dc.card.typeLine,
      manaCost: dc.card.manaCost,
      colors: JSON.parse(dc.card.colors) as string[],
      imageSmall: dc.card.imageSmall,
      imageNormal: dc.card.imageNormal,
      scryfallUri: dc.card.scryfallUri,
      keywords: JSON.parse(dc.card.keywordsJson) as string[],
    },
    quantity: dc.quantity,
  }));
  // Apply the same stoplist the browser applies by default, so the
  // SVG mirrors what the user actually sees.
  const top = topThreeKeywords(entries, COMMON_KEYWORD_STOPLIST);
  const freq = keywordFrequency(entries, COMMON_KEYWORD_STOPLIST).slice(0, 5);
  console.log(
    `Top keywords:`,
    freq.map((f) => `${f.keyword}(${f.count})`).join(" "),
  );

  const { nodes, edges } = buildMapElements(
    entries.map((e) => ({
      id: e.card.id,
      name: e.card.name,
      keywords: e.card.keywords,
    })),
    top,
    {
      includeTier4: true,
      excludeKeywords: COMMON_KEYWORD_STOPLIST,
      minClusterSize: 3,
    },
  );

  // Same packing algorithm as the React component — pure-math, no
  // headless cytoscape involved.
  const packed = packPieCloud(
    nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      tier: n.tier,
      shareCount: n.shareCount,
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

  // Tier counts for the inline stats banner.
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
    svg += `
    <line x1="${tx(a.x).toFixed(1)}" y1="${ty(a.y).toFixed(1)}" x2="${tx(b.x).toFixed(1)}" y2="${ty(b.y).toFixed(1)}" stroke-width="${EDGE_WIDTH[e.tier]}" stroke-opacity="${EDGE_OPACITY[e.tier]}"/>`;
  }
  svg += `\n  </g>\n  <g>`;

  for (const p of positions) {
    const { node, x, y } = p;
    const ax = tx(x) - node.width / 2;
    const ay = ty(y) - node.height / 2;
    svg += `
    <rect x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" width="${node.width}" height="${node.height}" fill="#1a1a1d" stroke="${TIER_BORDER[node.tier]}" stroke-width="${node.tier === "gold" ? 3 : node.tier === "none" ? 1 : 2}" rx="4"/>
    <text x="${tx(x).toFixed(1)}" y="${(ay + node.height + TIER_LABEL_SIZE[node.tier] + 4).toFixed(1)}" text-anchor="middle" fill="${TIER_LABEL_COLOR[node.tier]}" font-size="${TIER_LABEL_SIZE[node.tier]}" font-weight="${node.tier === "gold" ? 600 : 400}">${escapeXml(node.name)}</text>`;
  }
  svg += `
  </g>
  <g font-size="13" fill="#e7e5e4">
    <text x="20" y="${H - 60}" font-weight="600">${escapeXml(deck.name)}</text>
    <text x="20" y="${H - 42}" font-size="11" fill="#a1a1aa">${entries.length} cards · primary ${top.primary ?? "—"} · secondary ${top.secondary ?? "—"} · tertiary ${top.tertiary ?? "—"}</text>
    <text x="20" y="${H - 24}" font-size="11" fill="#a1a1aa">tiers: gold ${tierCounts.gold} / silver ${tierCounts.silver} / bronze ${tierCounts.bronze} / none ${tierCounts.none}  ·  edges T1:${edgeCounts[1]} T2:${edgeCounts[2]} T3:${edgeCounts[3]} T4:${edgeCounts[4]}  ·  ${W}×${H}px</text>
  </g>
</svg>`;

  const outDir = resolve(process.cwd(), "data");
  mkdirSync(outDir, { recursive: true });
  const out = resolve(outDir, "map-preview.svg");
  writeFileSync(out, svg, "utf8");
  console.log(`Wrote ${out}  (${W}×${H} px, ${nodes.length} nodes, ${edges.length} edges)`);
  console.log(
    `tiers: gold ${tierCounts.gold}, silver ${tierCounts.silver}, bronze ${tierCounts.bronze}, none ${tierCounts.none}`,
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
