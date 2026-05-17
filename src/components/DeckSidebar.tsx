import type { SynergySuggestion } from "@/lib/types";
import { CardChip } from "./CardChip";

export function DeckSidebar({ suggestions }: { suggestions: SynergySuggestion[] }) {
  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-ink-line px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-200">Suggested cards</h2>
        <p className="text-[11px] text-stone-500">
          Ranked by tier, then by overlap count.
        </p>
      </header>
      <ol className="flex-1 space-y-2 overflow-y-auto p-3">
        {suggestions.length === 0 && (
          <li className="text-xs text-stone-500">
            No candidate cards in the DB yet — run <code>pnpm seed</code> or{" "}
            <code>pnpm ingest</code>.
          </li>
        )}
        {suggestions.map((s) => (
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
