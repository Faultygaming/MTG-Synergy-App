"use client";

import { useMemo, useState } from "react";
import type { DeckEntry } from "@/lib/types";
import { CardActionButton } from "./CardActionButton";

interface Props {
  deckId: string;
  entries: DeckEntry[];
  commanderIds?: string[];
}

// Full deck listing with a "✕" button on every row. Complements the
// theme-aware "Cards to consider cutting" panel above: that one is a
// curated short list of likely cuts (cards matching 0 themes), this
// one is the escape hatch when the user wants to remove a card that
// IS pulling its weight thematically.
//
// Commander rows are flagged but the remove button is disabled — the
// commander is set at deck-creation and removing it from this panel
// would invalidate the deck without a way to pick a replacement.
export function DeckContentsPanel({ deckId, entries, commanderIds }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [filter, setFilter] = useState("");

  const cmdSet = useMemo(() => new Set(commanderIds ?? []), [commanderIds]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const sorted = [...entries].sort((a, b) =>
      a.card.name.localeCompare(b.card.name),
    );
    if (!f) return sorted;
    return sorted.filter(
      (e) =>
        e.card.name.toLowerCase().includes(f) ||
        e.card.typeLine.toLowerCase().includes(f) ||
        e.card.keywords.some((k) => k.includes(f)),
    );
  }, [entries, filter]);

  return (
    <div className="border-t border-ink-line bg-ink/60">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-baseline justify-between px-4 py-2 text-left hover:bg-ink-soft"
      >
        <div>
          <div className="text-sm font-semibold text-stone-200">
            Deck contents
            <span className="ml-2 rounded bg-ink-soft px-1.5 py-0.5 text-[10px] font-normal text-stone-400">
              {entries.length}
            </span>
          </div>
          <div className="text-[11px] text-stone-500">
            Remove any card with ✕. Type to filter by name, type, or keyword.
          </div>
        </div>
        <span className="text-stone-500">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="mb-2 w-full rounded border border-ink-line bg-ink px-2 py-1 text-xs text-stone-100 placeholder:text-stone-600 focus:border-tier-gold focus:outline-none"
          />
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {filtered.map((e) => {
              const isCmd = cmdSet.has(e.card.id);
              return (
                <li
                  key={e.card.id}
                  className="flex items-center gap-2 rounded bg-ink p-1.5"
                >
                  <div className="h-10 w-7 shrink-0 overflow-hidden rounded-sm bg-ink-line">
                    {e.card.imageSmall ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.card.imageSmall}
                        alt={e.card.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    {e.card.scryfallUri ? (
                      <a
                        href={e.card.scryfallUri}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs font-medium text-stone-200 hover:text-tier-gold"
                      >
                        {e.card.name}
                        {e.quantity > 1 && (
                          <span className="ml-1 text-stone-500">
                            ×{e.quantity}
                          </span>
                        )}
                        {isCmd && (
                          <span className="ml-1 rounded bg-tier-gold/20 px-1 text-[9px] uppercase tracking-wide text-tier-gold">
                            cmd
                          </span>
                        )}
                      </a>
                    ) : (
                      <div className="block truncate text-xs font-medium text-stone-200">
                        {e.card.name}
                      </div>
                    )}
                    <div className="truncate text-[10px] text-stone-500">
                      {e.card.typeLine}
                    </div>
                  </div>
                  {isCmd ? (
                    <span
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-stone-700"
                      title="Commander — change via the Rules panel"
                    >
                      ✕
                    </span>
                  ) : (
                    <CardActionButton
                      deckId={deckId}
                      cardId={e.card.id}
                      action="remove"
                      label={`Remove ${e.card.name} from deck`}
                    />
                  )}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-4 text-center text-[11px] text-stone-500">
                No matches.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
