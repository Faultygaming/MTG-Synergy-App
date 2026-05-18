"use client";

import { useEffect, useState } from "react";
import type { SynergySuggestion } from "@/lib/types";
import { CardChip } from "./CardChip";
import { CardActionButton } from "./CardActionButton";

interface Props {
  /** Top-N ranked suggestions server-rendered into the initial HTML.
   * Shown when the search box is empty. */
  suggestions: SynergySuggestion[];
  /** Deck id used by the server-side `/api/cards/search` endpoint to
   * score hits against the deck's keyword frequencies. */
  deckId: string;
}

// Suggestions sidebar with a live filter that searches the WHOLE local
// card DB, not just the top-N server-rendered list. Typing 2+ chars
// triggers a debounced fetch to /api/cards/search; results replace the
// default list until the search box is cleared.
//
// State is structured so render is fully derived from `query` + the
// last-fetched payload (no sync setState in the effect body — React
// 19's lint flags that pattern). The effect only writes inside its
// async setTimeout callback.
export function DeckSidebar({ suggestions, deckId }: Props) {
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<{
    q: string;
    data: SynergySuggestion[];
  } | null>(null);

  const trimmed = query.trim();
  const isSearching = trimmed.length >= 2;
  const fetchedMatchesQuery = fetched?.q === trimmed;
  const results = isSearching && fetchedMatchesQuery ? fetched.data : null;
  // We're "loading" when the user is searching but we don't yet have a
  // cached result for THIS exact query.
  const loading = isSearching && !fetchedMatchesQuery;

  useEffect(() => {
    if (trimmed.length < 2) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/cards/search?deck=${encodeURIComponent(deckId)}&q=${encodeURIComponent(trimmed)}`,
        );
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { results: SynergySuggestion[] };
        if (!cancelled) setFetched({ q: trimmed, data: body.results });
      } catch {
        // Network error or aborted — leave fetched unchanged.
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [trimmed, deckId]);

  const displayed = results ?? suggestions;

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
            placeholder="Search any card in the DB…"
            className="w-full rounded border border-ink-line bg-ink px-2 py-1 text-xs outline-none focus:border-tier-gold"
            aria-label="Search cards"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="shrink-0 text-[11px] text-stone-500 hover:text-stone-200"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {isSearching && (
          <p className="mt-1 text-[10px] text-stone-500">
            {loading
              ? "Searching…"
              : `${results!.length} match${results!.length === 1 ? "" : "es"} in the full DB`}
          </p>
        )}
      </header>
      <ol className="flex-1 space-y-2 overflow-y-auto p-3">
        {!isSearching && suggestions.length === 0 && (
          <li className="text-xs text-stone-500">
            No candidate cards in the DB yet — run <code>ingest</code> in the container.
          </li>
        )}
        {isSearching && results !== null && results.length === 0 && (
          <li className="text-xs text-stone-500">
            No cards match &quot;{query}&quot;. The card might not be in the
            local DB — run <code>ingest</code> to populate the full
            Scryfall corpus, or check the spelling.
          </li>
        )}
        {displayed.map((s) => (
          <li key={s.card.id}>
            <CardChip
              card={s.card}
              tier={s.tier}
              shareCount={s.shareCount}
              caption={s.sharedKeywords.slice(0, 3).join(", ")}
              rationale={s.rationale}
              action={
                <CardActionButton
                  deckId={deckId}
                  cardId={s.card.id}
                  action="add"
                  label={`Add ${s.card.name} to deck`}
                />
              }
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
