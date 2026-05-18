"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { SynergySuggestion } from "@/lib/types";
import { CardChip } from "./CardChip";

// Suggestions sidebar with a live name + keyword filter. Client-side
// filtering against the server-rendered suggestion list — for the
// default 60-card cap that's an instant operation, no debounce needed.
//
// The search input also matches against shared-keyword names so the
// user can quickly find "all gold cards that share ramp" by typing
// "ramp" instead of scrolling. useDeferredValue keeps typing snappy if
// the list grows past a few hundred entries.
export function DeckSidebar({ suggestions }: { suggestions: SynergySuggestion[] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter((s) => {
      if (s.card.name.toLowerCase().includes(q)) return true;
      for (const k of s.sharedKeywords) {
        if (k.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [suggestions, deferredQuery]);

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-ink-line px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-200">Suggested cards</h2>
        <p className="text-[11px] text-stone-500">
          Ranked by tier, then by overlap count.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or keyword…"
            className="w-full rounded border border-ink-line bg-ink px-2 py-1 text-xs outline-none focus:border-tier-gold"
            aria-label="Filter suggestions"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="shrink-0 text-[11px] text-stone-500 hover:text-stone-200"
              title="Clear filter"
            >
              ×
            </button>
          )}
        </div>
        {query && (
          <p className="mt-1 text-[10px] text-stone-500">
            {filtered.length} of {suggestions.length} match &quot;{query}&quot;
          </p>
        )}
      </header>
      <ol className="flex-1 space-y-2 overflow-y-auto p-3">
        {suggestions.length === 0 && (
          <li className="text-xs text-stone-500">
            No candidate cards in the DB yet — run <code>seed</code> or{" "}
            <code>ingest</code> in the container.
          </li>
        )}
        {suggestions.length > 0 && filtered.length === 0 && (
          <li className="text-xs text-stone-500">
            No suggestions match &quot;{query}&quot;.
          </li>
        )}
        {filtered.map((s) => (
          <li key={s.card.id}>
            <CardChip
              card={s.card}
              tier={s.tier}
              shareCount={s.shareCount}
              caption={s.sharedKeywords.slice(0, 3).join(", ")}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
