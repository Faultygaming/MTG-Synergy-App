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
  classifyCardByThemes,
  edgeTier as edgeTierFn,
  packForce,
  packPieCloud,
  packPlanetary,
  sizeFor as sizeForFn,
  subgroupKeyFor,
  ART_ASPECT,
  type MapTheme,
  type MapTier,
  type MapTop,
} from "@/lib/synergy/map";
import { buildExcludeSet } from "@/lib/synergy/stoplist";

type LayoutMode = "pie" | "planetary" | "force";

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
  // Deck's primary themes (computed server-side in deck/[id]/page.tsx).
  // When present, node tier classification uses theme membership instead
  // of raw top-3 keyword overlap, so the map's gold/silver/bronze ring
  // colors match what the sidebar shows.
  themes?: MapTheme[];
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

export function SynergyMap({ entries, themes }: Props) {
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
  // Layout mode. "pie" = current tier-sector wedges; "planetary" =
  // anchor cards on an outer ring with moons orbiting each.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("pie");

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
    //
    // Tier source: themes (when provided by the server) > raw top-3
    // keywords (fallback). Switching to themes was the May-2026 design
    // refactor; the keyword fallback is kept for the headless preview
    // script which doesn't compute themes.
    const classified = entries.map((e) => ({
      entry: e,
      ...(themes && themes.length > 0
        ? classifyCardByThemes(e.card.keywords, themes)
        : classifyCard(e.card.keywords, top)),
    }));
    const sizes = classified.map((c) => {
      const width = sizeForFn(c.tier, c.shareCount);
      return { width, height: Math.round(width / ART_ASPECT) };
    });
    // Per-keyword frequency map for both edge filtering AND subgroup
    // selection within each tier sector.
    const allKeywordCounts = new Map<string, number>();
    for (const e of entries) {
      for (const k of e.card.keywords) {
        if (excludeKeywords.has(k)) continue;
        allKeywordCounts.set(k, (allKeywordCounts.get(k) ?? 0) + 1);
      }
    }
    const packInputs = classified.map((c, i) => ({
      id: c.entry.card.id,
      width: sizes[i].width,
      height: sizes[i].height,
      tier: c.tier,
      shareCount: c.shareCount,
      subgroup: subgroupKeyFor(
        c.entry.card.keywords,
        top,
        excludeKeywords,
        allKeywordCounts,
      ),
      // Filter stoplisted keywords out of the planetary affinity
      // calculation so moons cluster around anchors based on real
      // synergy, not on "they're both creatures".
      keywords: c.entry.card.keywords.filter((k) => !excludeKeywords.has(k)),
    }));
    // Build the (filtered) edge list now — needed BOTH for the cytoscape
    // edge elements below AND, in force mode, as input to packForce.
    const pendingEdges: Array<{ source: string; target: string; tier: 1 | 2 | 3 | 4 }> = [];
    const MIN_CLUSTER = 3;
    const filteredKws = entries.map((e) =>
      e.card.keywords.filter((k) => !excludeKeywords.has(k)),
    );
    for (let i = 0; i < entries.length; i++) {
      const aSet = new Set(filteredKws[i]);
      for (let j = i + 1; j < entries.length; j++) {
        const bKws = filteredKws[j];
        const t = edgeTierFn(bKws, aSet, top);
        if (t === 0) continue;
        if (t === 4 && !showQuaternary) continue;
        if (t === 4) {
          let bestCount = 0;
          for (const k of bKws) {
            if (!aSet.has(k)) continue;
            const c = allKeywordCounts.get(k) ?? 0;
            if (c > bestCount) bestCount = c;
          }
          if (bestCount < MIN_CLUSTER) continue;
        }
        pendingEdges.push({
          source: entries[i].card.id,
          target: entries[j].card.id,
          tier: t,
        });
      }
    }

    const packed =
      layoutMode === "force"
        ? packForce(packInputs, pendingEdges)
        : layoutMode === "planetary"
          ? packPlanetary(packInputs)
          : packPieCloud(packInputs);
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

    // Now push the edges already computed for packForce (or computed
    // again above) as cytoscape elements.
    const keywordCounts = allKeywordCounts;
    for (const e of pendingEdges) {
      els.push({
        data: {
          id: `e:${e.source}|${e.target}`,
          source: `card:${e.source}`,
          target: `card:${e.target}`,
          edgeTier: String(e.tier),
        },
      });
    }
    void keywordCounts;

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
  }, [entries, top, themes, showKeywords, showQuaternary, layoutMode, excludeKeywords]);

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
        {/* Layout-mode segmented control */}
        <div
          className="flex overflow-hidden rounded border border-ink-line bg-ink/60 backdrop-blur-sm"
          role="radiogroup"
          aria-label="Layout mode"
        >
          {(["pie", "planetary", "force"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setLayoutMode(mode)}
              role="radio"
              aria-checked={layoutMode === mode}
              className={
                "px-2 py-1 capitalize " +
                (layoutMode === mode
                  ? "bg-tier-gold/20 text-tier-gold"
                  : "text-stone-400 hover:text-stone-100")
              }
              title={
                mode === "pie"
                  ? "Pie sectors by tier, sub-wedged by secondary keyword"
                  : mode === "planetary"
                    ? "Anchor cards on an outer ring with moons orbiting each"
                    : "Spring-electrical: cards gravitate toward their strongest shared-keyword neighbors"
              }
            >
              {mode}
            </button>
          ))}
        </div>
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
