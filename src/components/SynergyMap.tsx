"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { ElementDefinition, StylesheetStyle } from "cytoscape";
import type { DeckEntry } from "@/lib/types";

// react-cytoscapejs must be client-only (touches `window`).
const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), {
  ssr: false,
});

interface Props {
  entries: DeckEntry[];
  top: { primary?: string; secondary?: string; tertiary?: string };
}

export function SynergyMap({ entries, top }: Props) {
  const elements = useMemo<ElementDefinition[]>(() => {
    const els: ElementDefinition[] = [];
    // Card nodes.
    for (const e of entries) {
      els.push({
        data: {
          id: `card:${e.card.id}`,
          label: e.card.name,
          kind: "card",
          image: e.card.imageSmall ?? "",
        },
      });
    }
    // Keyword nodes + card↔keyword edges (bipartite).
    const seenKw = new Set<string>();
    for (const e of entries) {
      for (const k of e.card.keywords) {
        if (!seenKw.has(k)) {
          seenKw.add(k);
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
            id: `e:${e.card.id}:${k}`,
            source: `card:${e.card.id}`,
            target: `kw:${k}`,
          },
        });
      }
    }
    return els;
  }, [entries, top]);

  const stylesheet: StylesheetStyle[] = [
    {
      selector: "node[kind = 'card']",
      style: {
        "background-color": "#1a1a1d",
        "background-image": "data(image)",
        "background-fit": "cover",
        "border-color": "#2a2a30",
        "border-width": 1,
        label: "data(label)",
        "font-size": 8,
        color: "#aaa",
        "text-margin-y": 6,
        "text-valign": "bottom" as const,
        "text-halign": "center" as const,
        width: 36,
        height: 50,
        shape: "round-rectangle" as const,
      },
    },
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
      selector: "node[tier = 'gold']",
      style: {
        "background-color": "#d4af37",
        color: "#0e0e10",
        "border-color": "#fde68a",
        "border-width": 2,
      },
    },
    {
      selector: "node[tier = 'silver']",
      style: {
        "background-color": "#c0c0c0",
        color: "#0e0e10",
        "border-color": "#e5e7eb",
        "border-width": 2,
      },
    },
    {
      selector: "node[tier = 'bronze']",
      style: {
        "background-color": "#cd7f32",
        color: "#0e0e10",
        "border-color": "#fbbf77",
        "border-width": 2,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1,
        "line-color": "#3f3f46",
        opacity: 0.6,
        "curve-style": "bezier" as const,
      },
    },
  ];

  return (
    <div className="cy-host">
      <CytoscapeComponent
        elements={elements}
        style={{ width: "100%", height: "100%" }}
        stylesheet={stylesheet}
        layout={{ name: "cose", animate: false, padding: 30 } as unknown as cytoscape.LayoutOptions}
        minZoom={0.2}
        maxZoom={2}
      />
    </div>
  );
}
