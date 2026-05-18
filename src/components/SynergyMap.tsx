"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  Core,
  ElementDefinition,
  EventObject,
  StylesheetStyle,
} from "cytoscape";
import type { DeckEntry } from "@/lib/types";
import {
  classifyCard,
  edgeTier as edgeTierFn,
  packPieCloud,
  sizeFor as sizeForFn,
  ART_ASPECT,
  type MapTier,
  type MapTop,
} from "@/lib/synergy/map";
import { buildExcludeSet } from "@/lib/synergy/stoplist";

// react-cytoscapejs must be client-only (touches `window`). We also
// register the cose-bilkent layout extension here so it's available
// inside the synergy map — produces noticeably better-packed clusters
// than plain `cose` at the 99-card-plus-edges scale we render.
const CytoscapeComponent = dynamic(
  async () => {
    const [{ default: cytoscape }, { default: coseBilkent }, mod] = await Promise.all([
      import("cytoscape"),
      import("cytoscape-cose-bilkent"),
      import("react-cytoscapejs"),
    ]);
    // cose-bilkent has no published types; the extension is a function
    // matching cytoscape's Ext signature at runtime.
    cytoscape.use(coseBilkent as Parameters<typeof cytoscape.use>[0]);
    return mod;
  },
  { ssr: false },
);

// Scryfall image URLs follow a stable size segment, so we can derive an
// art-crop URL from the normal URL by string replacement. Art crops drop
// the text box entirely — much more readable as cloud nodes than the full
// card. The hover overlay still shows the full normal-size card.
function artCropFor(url: string | null | undefined): string {
  if (!url) return "";
  return url.replace("/normal/", "/art_crop/").replace("/small/", "/art_crop/");
}

// ART_ASPECT, MapTier, MapTop are re-exported from @/lib/synergy/map so
// the offline preview script stays in sync.

interface Props {
  entries: DeckEntry[];
}

// Sizing + tier classification + edge derivation moved to
// src/lib/synergy/map.ts so the same code runs both client-side (here)
// and headless-side (scripts/preview-map.ts) for visual regression checks.
type CardTier = MapTier;
type Top = MapTop;

const EDGE_TIER_WIDTH: Record<1 | 2 | 3 | 4, number> = {
  1: 3.0,
  2: 2.0,
  3: 1.2,
  4: 0.4,
};
const EDGE_TIER_OPACITY: Record<1 | 2 | 3 | 4, number> = {
  1: 0.7,
  2: 0.45,
  3: 0.3,
  4: 0.08,
};

export function SynergyMap({ entries }: Props) {
  // UI toggles ------------------------------------------------------------
  // Default view is card-only; flip to add keyword nodes back in.
  const [showKeywords, setShowKeywords] = useState(false);
  // Quaternary edges (cards that share a keyword that ISN'T in the deck's
  // top-3) are how we keep otherwise-isolated cards inside the cluster.
  // Without them, the cose layout shoves disconnected components far
  // apart and the viewport ends up mostly black. We default ON now and
  // style them very subtly so they don't visually dominate.
  const [showQuaternary, setShowQuaternary] = useState(true);
  // Show keywords like `creature`, `land`, `produces-g` that always
  // dominate frequency rankings without representing real synergy.
  // Off = the curated stoplist is applied (see src/lib/synergy/stoplist.ts).
  const [showCommonWords, setShowCommonWords] = useState(false);

  // Stoplist + min-cluster threshold applied to BOTH top-3 derivation
  // (so the gold/silver/bronze tiers reflect actual themes) and tier-4
  // edge derivation (so a keyword shared by only 1-2 cards doesn't
  // draw a noise edge).
  const excludeKeywords = useMemo(
    () => buildExcludeSet({ applyCommon: !showCommonWords }),
    [showCommonWords],
  );

  // Hover-magnify state ---------------------------------------------------
  const [shiftDown, setShiftDown] = useState(false);
  const [hover, setHover] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftDown(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftDown(false);
    };
    // Some browsers fire blur without keyup if the user tab-switches with
    // Shift held; clear state defensively.
    const onBlur = () => setShiftDown(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Index for hover overlay lookup.
  const cardIndex = useMemo(() => {
    const m = new Map<string, DeckEntry["card"]>();
    for (const e of entries) m.set(e.card.id, e.card);
    return m;
  }, [entries]);

  // Recompute top-3 from the current toggle state. When the stoplist
  // is on (showCommonWords = false), `creature` and friends are filtered
  // out, and the actually-interesting keywords (landfall, etb-trigger,
  // ramp) get promoted into the tier slots.
  const top = useMemo<Top>(() => {
    const filtered = (e: DeckEntry) =>
      e.card.keywords.filter((k) => !excludeKeywords.has(k));
    const counts = new Map<string, number>();
    for (const e of entries) {
      for (const k of filtered(e)) {
        counts.set(k, (counts.get(k) ?? 0) + e.quantity);
      }
    }
    const sorted = Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    return {
      primary: sorted[0]?.[0],
      secondary: sorted[1]?.[0],
      tertiary: sorted[2]?.[0],
    };
  }, [entries, excludeKeywords]);

  // Cytoscape elements ----------------------------------------------------
  const elements = useMemo<ElementDefinition[]>(() => {
    const els: ElementDefinition[] = [];

    // Card nodes, sized by tier band + share count, positioned via
    // packPieCloud (one circular cloud, pie-sectors by tier, no overlap).
    const classified = entries.map((e) => ({
      entry: e,
      ...classifyCard(e.card.keywords, top),
    }));
    const sizes = classified.map((c) => {
      const width = sizeForFn(c.tier, c.shareCount);
      return { width, height: Math.round(width / ART_ASPECT) };
    });
    const packed = packPieCloud(
      classified.map((c, i) => ({
        id: c.entry.card.id,
        width: sizes[i].width,
        height: sizes[i].height,
        tier: c.tier,
        shareCount: c.shareCount,
      })),
    );
    const positionById = new Map(packed.map((p) => [p.id, p]));

    for (let i = 0; i < classified.length; i++) {
      const c = classified[i];
      const { width, height } = sizes[i];
      const img =
        artCropFor(c.entry.card.imageNormal) ||
        artCropFor(c.entry.card.imageSmall);
      const pos = positionById.get(c.entry.card.id) ?? { x: 0, y: 0 };
      els.push({
        data: {
          id: `card:${c.entry.card.id}`,
          label: c.entry.card.name,
          kind: "card",
          image: img,
          tier: c.tier,
          width,
          height,
        },
        position: { x: pos.x, y: pos.y },
      });
    }

    // Card↔card edges with stoplist + min-cluster filtering. Drops
    // stoplisted keywords from each card's set before deriving the
    // edge, and suppresses tier-4 edges whose strongest underlying
    // shared keyword appears on < 3 cards in the deck (so isolated
    // pairs don't draw a "synergy" line). Top-3 edges (gold/silver/
    // bronze) always render — they back the tiers the user opted into.
    const MIN_CLUSTER = 3;
    const keywordCounts = new Map<string, number>();
    for (const e of entries) {
      for (const k of e.card.keywords) {
        if (excludeKeywords.has(k)) continue;
        keywordCounts.set(k, (keywordCounts.get(k) ?? 0) + 1);
      }
    }
    const filteredKws = entries.map((e) =>
      e.card.keywords.filter((k) => !excludeKeywords.has(k)),
    );
    for (let i = 0; i < entries.length; i++) {
      const aId = entries[i].card.id;
      const aSet = new Set(filteredKws[i]);
      for (let j = i + 1; j < entries.length; j++) {
        const bKws = filteredKws[j];
        const t = edgeTierFn(bKws, aSet, top);
        if (t === 0) continue;
        if (t === 4 && !showQuaternary) continue;
        if (t === 4) {
          // Find the most-common shared keyword backing this edge.
          // Drop the edge if even that keyword is rare in the deck.
          let bestCount = 0;
          for (const k of bKws) {
            if (!aSet.has(k)) continue;
            const c = keywordCounts.get(k) ?? 0;
            if (c > bestCount) bestCount = c;
          }
          if (bestCount < MIN_CLUSTER) continue;
        }
        const bId = entries[j].card.id;
        els.push({
          data: {
            id: `e:${aId}|${bId}`,
            source: `card:${aId}`,
            target: `card:${bId}`,
            edgeTier: String(t),
          },
        });
      }
    }

    // Optional keyword overlay — restores the bipartite view when toggled on.
    // Applies the SAME filters as the card-edge path: drop stoplisted
    // keywords, and drop keywords carried by fewer than MIN_CLUSTER cards
    // (so a single-card keyword can't float in the canvas with one
    // dangling line). Top-3 keywords (gold/silver/bronze) bypass the
    // cluster floor — they're visible by user intent.
    if (showKeywords) {
      const seen = new Set<string>();
      for (const e of entries) {
        for (const k of e.card.keywords) {
          if (excludeKeywords.has(k)) continue;
          const count = keywordCounts.get(k) ?? 0;
          const isTopKw =
            k === top.primary || k === top.secondary || k === top.tertiary;
          if (!isTopKw && count < MIN_CLUSTER) continue;
          if (!seen.has(k)) {
            seen.add(k);
            const tier =
              k === top.primary
                ? "gold"
                : k === top.secondary
                  ? "silver"
                  : k === top.tertiary
                    ? "bronze"
                    : "none";
            els.push({
              data: { id: `kw:${k}`, label: k, kind: "keyword", tier },
            });
          }
          els.push({
            data: {
              id: `kwe:${e.card.id}|${k}`,
              source: `card:${e.card.id}`,
              target: `kw:${k}`,
              kwEdge: "1",
            },
          });
        }
      }
    }

    return els;
  }, [entries, top, showKeywords, showQuaternary]);

  const stylesheet: StylesheetStyle[] = useMemo(
    () => [
      // Card nodes: art-crop image fill, landscape frame, name label
      // beneath. Size driven from data so React owns the math.
      {
        selector: "node[kind = 'card']",
        style: {
          "background-color": "#1a1a1d",
          "background-image": "data(image)",
          "background-fit": "cover",
          "border-color": "#2a2a30",
          "border-width": 1,
          label: "data(label)",
          color: "#71717a",
          "font-size": 8,
          "font-family": "ui-sans-serif, system-ui, sans-serif",
          "text-valign": "bottom" as const,
          "text-halign": "center" as const,
          "text-margin-y": 6,
          "text-max-width": "120px",
          "text-wrap": "ellipsis" as const,
          width: "data(width)" as unknown as number,
          height: "data(height)" as unknown as number,
          shape: "round-rectangle" as const,
        },
      },
      // Tier-colored frames + label emphasis. Gold > silver > bronze.
      {
        selector: "node[tier = 'gold']",
        style: {
          "border-color": "#d4af37",
          "border-width": 3,
          color: "#fde68a",
          "font-size": 13,
          "font-weight": 600,
          "text-margin-y": 8,
        },
      },
      {
        selector: "node[tier = 'silver']",
        style: {
          "border-color": "#c0c0c0",
          "border-width": 2,
          color: "#e7e5e4",
          "font-size": 11,
          "text-margin-y": 7,
        },
      },
      {
        selector: "node[tier = 'bronze']",
        style: {
          "border-color": "#cd7f32",
          "border-width": 2,
          color: "#d6a373",
          "font-size": 10,
          "text-margin-y": 6,
        },
      },
      // Card-card edges: light teal with thickness keyed off edgeTier.
      {
        selector: "edge[edgeTier = '1']",
        style: {
          width: EDGE_TIER_WIDTH[1],
          "line-color": "#5eead4",
          opacity: EDGE_TIER_OPACITY[1],
          "curve-style": "haystack" as const,
        },
      },
      {
        selector: "edge[edgeTier = '2']",
        style: {
          width: EDGE_TIER_WIDTH[2],
          "line-color": "#5eead4",
          opacity: EDGE_TIER_OPACITY[2],
          "curve-style": "haystack" as const,
        },
      },
      {
        selector: "edge[edgeTier = '3']",
        style: {
          width: EDGE_TIER_WIDTH[3],
          "line-color": "#5eead4",
          opacity: EDGE_TIER_OPACITY[3],
          "curve-style": "haystack" as const,
        },
      },
      {
        selector: "edge[edgeTier = '4']",
        style: {
          width: EDGE_TIER_WIDTH[4],
          "line-color": "#5eead4",
          opacity: EDGE_TIER_OPACITY[4],
          "curve-style": "haystack" as const,
        },
      },
      // Keyword overlay (only present when showKeywords).
      {
        selector: "node[kind = 'keyword']",
        style: {
          "background-color": "#27272a",
          label: "data(label)",
          color: "#e7e5e4",
          "font-size": 11,
          "font-weight": 600,
          width: 18,
          height: 18,
          shape: "round-rectangle" as const,
          padding: "8px",
          "text-valign": "center" as const,
          "text-halign": "center" as const,
          "border-width": 1,
          "border-color": "#3f3f46",
        },
      },
      {
        selector: "node[kind = 'keyword'][tier = 'gold']",
        style: { "background-color": "#d4af37", color: "#0e0e10" },
      },
      {
        selector: "node[kind = 'keyword'][tier = 'silver']",
        style: { "background-color": "#c0c0c0", color: "#0e0e10" },
      },
      {
        selector: "node[kind = 'keyword'][tier = 'bronze']",
        style: { "background-color": "#cd7f32", color: "#0e0e10" },
      },
      {
        selector: "edge[kwEdge = '1']",
        style: {
          width: 1,
          "line-color": "#3f3f46",
          opacity: 0.4,
          "curve-style": "bezier" as const,
        },
      },
    ],
    [],
  );

  // Cytoscape ref + hover wiring -----------------------------------------
  const cyRef = useRef<Core | null>(null);
  function bindCy(cy: Core) {
    cyRef.current = cy;
    const onOver = (evt: EventObject) => {
      const node = evt.target;
      if (!node || node.isEdge?.()) return;
      const id = String(node.id());
      if (!id.startsWith("card:")) return;
      const pos = node.renderedPosition();
      setHover({ id: id.slice("card:".length), x: pos.x, y: pos.y });
    };
    const onOut = () => setHover(null);
    cy.off("mouseover").on("mouseover", "node", onOver);
    cy.off("mouseout").on("mouseout", "node", onOut);
    cy.off("tap").on("tap", () => setHover(null));
    // Fit-to-viewport once the initial layout settles. Without this the
    // user lands on whatever pan/zoom cytoscape chose by default, which
    // for force-directed layouts is often "way off to the side" or
    // "zoomed in to a corner". 40px padding leaves breathing room.
    cy.off("layoutstop").on("layoutstop", () => cy.fit(undefined, 40));
  }

  const hovered = hover ? cardIndex.get(hover.id) : null;
  const showOverlay = shiftDown && hover && hovered;

  return (
    <div className="relative h-full w-full">
      {/* Controls strip --------------------------------------------------- */}
      <div className="absolute right-3 top-3 z-10 flex gap-2 text-[11px]">
        <button
          onClick={() => cyRef.current?.fit(undefined, 40)}
          className="rounded border border-ink-line bg-ink/60 px-2 py-1 text-stone-300 backdrop-blur-sm hover:text-stone-100"
          title="Re-center the layout to fit the viewport"
        >
          Fit
        </button>
        <button
          onClick={() => setShowKeywords((v) => !v)}
          className={
            "rounded border px-2 py-1 backdrop-blur-sm " +
            (showKeywords
              ? "border-tier-gold bg-tier-gold/20 text-tier-gold"
              : "border-ink-line bg-ink/60 text-stone-300 hover:text-stone-100")
          }
          title="Overlay keyword nodes connecting cards by shared keyword"
        >
          {showKeywords ? "Hide keywords" : "Show keywords"}
        </button>
        <button
          onClick={() => setShowQuaternary((v) => !v)}
          className={
            "rounded border px-2 py-1 backdrop-blur-sm " +
            (showQuaternary
              ? "border-teal-400 bg-teal-400/20 text-teal-200"
              : "border-ink-line bg-ink/60 text-stone-300 hover:text-stone-100")
          }
          title="Draw the thinnest tier of edges (cards sharing a non-top-3 keyword)"
        >
          {showQuaternary ? "Dense edges" : "Sparse edges"}
        </button>
        <button
          onClick={() => setShowCommonWords((v) => !v)}
          className={
            "rounded border px-2 py-1 backdrop-blur-sm " +
            (showCommonWords
              ? "border-amber-400 bg-amber-400/20 text-amber-200"
              : "border-ink-line bg-ink/60 text-stone-300 hover:text-stone-100")
          }
          title="Include common words like 'creature' / 'land' / 'produces-g' in tier ranking + edges. Off by default so synergy themes win the top-3 slots."
        >
          {showCommonWords ? "Common words on" : "Common words hidden"}
        </button>
        <span className="rounded border border-ink-line bg-ink/60 px-2 py-1 text-stone-500">
          shift + hover to enlarge
        </span>
      </div>

      <div className="cy-host">
        <CytoscapeComponent
          elements={elements}
          style={{ width: "100%", height: "100%" }}
          stylesheet={stylesheet}
          layout={
            {
              // packPieCloud computed the positions; cytoscape just
              // honors them. No physics, no iterations — instant render
              // with structurally-guaranteed no-overlap.
              name: "preset",
              animate: false,
              padding: 40,
              fit: true,
            } as unknown as cytoscape.LayoutOptions
          }
          minZoom={0.2}
          maxZoom={3}
          cy={bindCy}
        />
      </div>

      {/* Magnified hover overlay --------------------------------------- */}
      {showOverlay ? (
        // Centered overlay fixed to the viewport. The image scales to
        // the smaller of (viewport - 80px) on each axis while preserving
        // the card's natural aspect ratio. pointer-events-none keeps the
        // mouseout event on the underlying node firing so dismissal
        // works as soon as the cursor leaves.
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center p-10">
          <div className="rounded-md border border-tier-gold/60 bg-ink-soft p-1 shadow-tier-gold">
            {hovered!.imageNormal ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hovered!.imageNormal}
                alt={hovered!.name}
                className="block max-h-[calc(100vh-80px)] max-w-[calc(100vw-80px)] rounded"
              />
            ) : (
              <div className="flex h-[calc(min(100vh-80px,680px))] w-[calc(min(100vw-80px,488px))] items-center justify-center rounded bg-ink p-2 text-center text-xs text-stone-400">
                {hovered!.name}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
