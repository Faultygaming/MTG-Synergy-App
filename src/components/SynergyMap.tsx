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

// react-cytoscapejs must be client-only (touches `window`).
const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), {
  ssr: false,
});

interface Top {
  primary?: string;
  secondary?: string;
  tertiary?: string;
}

interface Props {
  entries: DeckEntry[];
  top: Top;
}

// Card sizing is band-based so the tier-dominance rule from the synergy
// ranker holds visually: a gold card with any shareCount is always bigger
// than a silver card with any shareCount. Within a band, share count
// (number of deck top-3 keywords this card carries) picks the size.
const SIZE_BANDS = {
  gold:   { min: 64, max: 104 },
  silver: { min: 42, max: 60 },
  bronze: { min: 28, max: 40 },
  none:   { min: 18, max: 26 },
} as const;

type CardTier = keyof typeof SIZE_BANDS;

function sizeFor(tier: CardTier, shareCount: number): number {
  const band = SIZE_BANDS[tier];
  const t = Math.min(1, shareCount / 3); // saturate at 3 top-3 matches
  return Math.round(band.min + (band.max - band.min) * t);
}

// For each card in the deck, classify by which of the deck's top-3
// keywords it carries. Card "tier" is the highest top-3 keyword it has;
// shareCount is how many of the top-3 it has (0..3).
function classifyDeckCard(
  keywords: readonly string[],
  top: Top,
): { tier: CardTier; shareCount: number } {
  const hasP = !!top.primary && keywords.includes(top.primary);
  const hasS = !!top.secondary && keywords.includes(top.secondary);
  const hasT = !!top.tertiary && keywords.includes(top.tertiary);
  const shareCount = (hasP ? 1 : 0) + (hasS ? 1 : 0) + (hasT ? 1 : 0);
  const tier: CardTier = hasP ? "gold" : hasS ? "silver" : hasT ? "bronze" : "none";
  return { tier, shareCount };
}

// Edge tier between two deck cards = the highest-priority keyword they
// BOTH share (1 = both share primary, 2 = secondary, 3 = tertiary,
// 4 = any other shared keyword). Returns 0 if they share nothing.
function edgeTier(
  aKws: readonly string[],
  bKwsSet: Set<string>,
  top: Top,
): 0 | 1 | 2 | 3 | 4 {
  let best: 0 | 1 | 2 | 3 | 4 = 0;
  for (const k of aKws) {
    if (!bKwsSet.has(k)) continue;
    if (k === top.primary) return 1; // can't beat primary; bail early
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

const EDGE_TIER_WIDTH: Record<1 | 2 | 3 | 4, number> = {
  1: 3.2,
  2: 2.2,
  3: 1.4,
  4: 0.6,
};
const EDGE_TIER_OPACITY: Record<1 | 2 | 3 | 4, number> = {
  1: 0.8,
  2: 0.55,
  3: 0.4,
  4: 0.18,
};

export function SynergyMap({ entries, top }: Props) {
  // UI toggles ------------------------------------------------------------
  // Default view is card-only; flip to add keyword nodes back in.
  const [showKeywords, setShowKeywords] = useState(false);
  // Quaternary edges (cards that share a keyword that ISN'T in the deck's
  // top-3) are very numerous on a 99-card deck — off by default to avoid
  // a hairball. Toggle on for a denser look.
  const [showQuaternary, setShowQuaternary] = useState(false);

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

  // Cytoscape elements ----------------------------------------------------
  const elements = useMemo<ElementDefinition[]>(() => {
    const els: ElementDefinition[] = [];

    // Card nodes, sized by tier band + share count.
    const classified = entries.map((e) => ({
      entry: e,
      ...classifyDeckCard(e.card.keywords, top),
    }));
    for (const c of classified) {
      const size = sizeFor(c.tier, c.shareCount);
      els.push({
        data: {
          id: `card:${c.entry.card.id}`,
          label: c.entry.card.name,
          kind: "card",
          image: c.entry.card.imageNormal ?? c.entry.card.imageSmall ?? "",
          tier: c.tier,
          size,
        },
      });
    }

    // Card↔card edges, classified by best-shared-keyword tier.
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i].card;
      const aSet = new Set(a.keywords);
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j].card;
        const t = edgeTier(b.keywords, aSet, top);
        if (t === 0) continue;
        if (t === 4 && !showQuaternary) continue;
        els.push({
          data: {
            id: `e:${a.id}|${b.id}`,
            source: `card:${a.id}`,
            target: `card:${b.id}`,
            edgeTier: String(t),
          },
        });
      }
    }

    // Optional keyword overlay — restores the bipartite view when toggled on.
    if (showKeywords) {
      const seen = new Set<string>();
      for (const e of entries) {
        for (const k of e.card.keywords) {
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
      // Card nodes: image fill, square frame, size driven by `data(size)`.
      {
        selector: "node[kind = 'card']",
        style: {
          "background-color": "#1a1a1d",
          "background-image": "data(image)",
          "background-fit": "cover",
          "border-color": "#2a2a30",
          "border-width": 1,
          label: "",
          width: "data(size)" as unknown as number,
          height: ("data(size)" as unknown as number),
          shape: "round-rectangle" as const,
        },
      },
      // Tier-colored frames around card nodes.
      {
        selector: "node[tier = 'gold']",
        style: { "border-color": "#d4af37", "border-width": 3 },
      },
      {
        selector: "node[tier = 'silver']",
        style: { "border-color": "#c0c0c0", "border-width": 2 },
      },
      {
        selector: "node[tier = 'bronze']",
        style: { "border-color": "#cd7f32", "border-width": 2 },
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
  }

  const hovered = hover ? cardIndex.get(hover.id) : null;
  const showOverlay = shiftDown && hover && hovered;

  return (
    <div className="relative h-full w-full">
      {/* Controls strip --------------------------------------------------- */}
      <div className="absolute right-3 top-3 z-10 flex gap-2 text-[11px]">
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
              name: "cose",
              animate: false,
              padding: 40,
              // Force-directed tuning: pull edges into clusters but keep
              // nodes well-separated so card images stay readable at base
              // sizes. Adjust gravity if 99-card decks feel cramped.
              nodeRepulsion: 8000,
              idealEdgeLength: 80,
              edgeElasticity: 0.45,
              gravity: 0.25,
              numIter: 600,
            } as unknown as cytoscape.LayoutOptions
          }
          minZoom={0.25}
          maxZoom={3}
          cy={bindCy}
        />
      </div>

      {/* Magnified hover overlay --------------------------------------- */}
      {showOverlay ? (
        <div
          className="pointer-events-none absolute z-20"
          style={{
            // Offset so the magnified card doesn't sit directly under the
            // cursor (would prevent mouseout from firing on the underlying
            // node). Use the node's rendered position + a small offset.
            left: hover!.x + 18,
            top: hover!.y - 168,
          }}
        >
          <div className="rounded-md border border-tier-gold/60 bg-ink-soft p-1 shadow-tier-gold">
            {hovered!.imageNormal ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hovered!.imageNormal}
                alt={hovered!.name}
                width={240}
                height={336}
                className="block rounded"
              />
            ) : (
              <div className="flex h-[336px] w-[240px] items-center justify-center rounded bg-ink p-2 text-center text-xs text-stone-400">
                {hovered!.name}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
