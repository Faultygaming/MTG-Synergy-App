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
}

export function CardChip({ card, tier, shareCount, caption, rationale }: Props) {
  return (
    <a
      href={card.scryfallUri ?? "#"}
      target={card.scryfallUri ? "_blank" : undefined}
      rel="noreferrer"
      className={clsx(
        "group relative flex items-start gap-3 rounded-md bg-ink p-2 transition-transform hover:-translate-y-0.5",
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
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-medium text-stone-100">
            {card.name}
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
    </a>
  );
}
