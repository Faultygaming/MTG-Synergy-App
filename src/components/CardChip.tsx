import type { ReactNode } from "react";
import type { CardSummary, Tier } from "@/lib/types";
import { TIER_RING_CLASS, TIER_BADGE_CLASS } from "@/lib/synergy/tiers";
import clsx from "clsx";

interface Props {
  card: CardSummary;
  tier: Tier | null;
  shareCount?: number;
  // Optional small caption shown under the card (e.g. shared-keyword list).
  caption?: string;
  // Theme rationale: one-line "why this card fits". Rendered below the
  // caption in lighter italic when present.
  rationale?: string;
  // Optional action button (CardActionButton, etc.) rendered in the
  // top-right corner of the chip. Suggestions use "+" to add; removal
  // candidates use "✕" to remove.
  action?: ReactNode;
}

// Card row used by the sidebar suggestion list and removal panel.
// Previously the whole chip was an anchor to Scryfall; that made it
// impossible to nest a button inside (invalid HTML + bubbling).
// Now the chip is a div, and the card name doubles as the Scryfall
// link. The action button (when provided) is a separate <button>.
export function CardChip({
  card,
  tier,
  shareCount,
  caption,
  rationale,
  action,
}: Props) {
  return (
    <div
      className={clsx(
        "group relative flex items-start gap-3 rounded-md bg-ink p-2",
        TIER_RING_CLASS[tier ?? "none"],
      )}
    >
      <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-sm bg-ink-line">
        {card.imageSmall ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.imageSmall}
            alt={card.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {card.scryfallUri ? (
              <a
                href={card.scryfallUri}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm font-medium text-stone-100 hover:text-tier-gold"
              >
                {card.name}
              </a>
            ) : (
              <div className="truncate text-sm font-medium text-stone-100">
                {card.name}
              </div>
            )}
          </div>
          {tier ? (
            <span
              className={clsx(
                "shrink-0 rounded-full px-1.5 text-[10px] font-bold uppercase tracking-wide",
                TIER_BADGE_CLASS[tier],
              )}
              title={`${tier} synergy · ${shareCount ?? 0} shared`}
            >
              {shareCount ?? 0}
            </span>
          ) : null}
        </div>
        <div className="truncate text-[11px] text-stone-500">{card.typeLine}</div>
        {caption ? (
          <div className="mt-1 truncate text-[11px] text-stone-400">{caption}</div>
        ) : null}
        {rationale ? (
          <div className="mt-0.5 line-clamp-2 text-[10px] italic text-stone-500">
            {rationale}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
