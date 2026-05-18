"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";

type Action = "add" | "remove";

interface Props {
  deckId: string;
  cardId: string;
  action: Action;
  // Accessible label shown via title= and aria-label.
  label?: string;
}

// "+" or "✕" button rendered on a CardChip / removal-panel row.
// Calls POST or DELETE /api/decks/[id]/cards/[cardId] and revalidates
// the deck page so the server-rendered suggestions, themes, and the
// removal-panel list re-render with the new deck contents.
//
// Sized for 44px touch targets (Apple HIG / Material) so it works on
// phone screens without sub-pixel tapping.
export function CardActionButton({ deckId, cardId, action, label }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const symbol = action === "add" ? "+" : "✕";
  const ariaLabel =
    label ?? (action === "add" ? "Add to deck" : "Remove from deck");

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/decks/${deckId}/cards/${cardId}`, {
          method: action === "add" ? "POST" : "DELETE",
        });
        if (!res.ok) {
          setErr(`HTTP ${res.status}`);
          return;
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "fetch failed");
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={err ? `Error: ${err}` : ariaLabel}
      aria-label={ariaLabel}
      className={clsx(
        // 44x44 to satisfy touch-target accessibility minimums.
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg font-bold transition-colors",
        action === "add"
          ? "bg-tier-gold/15 text-tier-gold hover:bg-tier-gold/30 disabled:bg-tier-gold/5"
          : "bg-red-950/40 text-red-300 hover:bg-red-900/60 disabled:bg-red-950/20",
        pending && "cursor-wait opacity-50",
        err && "ring-1 ring-red-500/70",
      )}
    >
      {pending ? "…" : symbol}
    </button>
  );
}
