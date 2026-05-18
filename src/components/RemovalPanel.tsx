"use client";

import { useState } from "react";
import type { RemovalCandidate } from "@/lib/types";
import { CardActionButton } from "./CardActionButton";

interface Props {
  deckId: string;
  candidates: RemovalCandidate[];
}

// "Cards to consider cutting" — bottom-N of the deck by theme-fit.
// Server-computed; this client component just renders + handles
// collapse state and surfaces a one-tap remove button per row.
export function RemovalPanel({ deckId, candidates }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-t border-ink-line bg-ink/60">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-baseline justify-between px-4 py-2 text-left hover:bg-ink-soft"
      >
        <div>
          <div className="text-sm font-semibold text-stone-200">
            Cards to consider cutting
            <span className="ml-2 rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] font-normal text-red-300">
              {candidates.length}
            </span>
          </div>
          <div className="text-[11px] text-stone-500">
            Match none of your deck&apos;s primary themes.
          </div>
        </div>
        <span className="text-stone-500">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <ul className="max-h-64 space-y-1 overflow-y-auto px-3 pb-3">
          {candidates.map((r) => (
            <li
              key={r.card.id}
              className="flex items-center gap-2 rounded bg-ink p-1.5"
            >
              <div className="h-10 w-7 shrink-0 overflow-hidden rounded-sm bg-ink-line">
                {r.card.imageSmall ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.card.imageSmall}
                    alt={r.card.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                {r.card.scryfallUri ? (
                  <a
                    href={r.card.scryfallUri}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs font-medium text-stone-200 hover:text-tier-gold"
                  >
                    {r.card.name}
                  </a>
                ) : (
                  <div className="block truncate text-xs font-medium text-stone-200">
                    {r.card.name}
                  </div>
                )}
                <div className="truncate text-[10px] text-stone-500">
                  {r.card.typeLine}
                </div>
              </div>
              <CardActionButton
                deckId={deckId}
                cardId={r.card.id}
                action="remove"
                label={`Remove ${r.card.name} from deck`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
