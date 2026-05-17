"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SAMPLE = `1 Aftermath Analyst
1 Arcane Signet
1 Augur of Autumn
1 Beast Within
1 Cultivate
1 Eternal Witness
1 Exploration
1 Farseek
1 Life from the Loam
1 Lord Windgrace
1 Ramunap Excavator
1 Sol Ring
1 Splendid Reclamation
1 Tireless Tracker
1 Worldsoul's Rage`;

export function DeckPasteForm() {
  const router = useRouter();
  const [name, setName] = useState("My Synergy Deck");
  const [commander, setCommander] = useState("");
  const [partner, setPartner] = useState("");
  const [list, setList] = useState(SAMPLE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const commanders = [commander, partner]
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const res = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "paste",
          name,
          decklist: list,
          commanders,
        }),
      });
      const body = (await res.json()) as
        | { id: string; missing: string[] }
        | { error: string };
      if (!res.ok || "error" in body) {
        setError("error" in body ? body.error : "Failed to create deck");
        setSubmitting(false);
        return;
      }
      router.push(`/deck/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-300">
          Deck name
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-ink-line bg-ink-soft px-3 py-2 text-sm outline-none focus:border-tier-gold"
          required
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-stone-300">
            Commander
          </span>
          <input
            type="text"
            value={commander}
            onChange={(e) => setCommander(e.target.value)}
            placeholder="e.g. Hearthhull, the Worldseed"
            className="w-full rounded-md border border-ink-line bg-ink-soft px-3 py-2 text-sm outline-none focus:border-tier-gold"
          />
          <span className="mt-1 block text-[11px] text-stone-500">
            Sets the color identity for the 99. Required for Commander rules
            to be enforced.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-stone-300">
            Partner / Background <span className="text-stone-500">(optional)</span>
          </span>
          <input
            type="text"
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
            placeholder="for Partner / Background pairings"
            className="w-full rounded-md border border-ink-line bg-ink-soft px-3 py-2 text-sm outline-none focus:border-tier-gold"
          />
          <span className="mt-1 block text-[11px] text-stone-500">
            Validated by the Commander rules engine; mismatched pairings
            will surface as violations.
          </span>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-300">
          Decklist (99 cards for Commander)
        </span>
        <textarea
          value={list}
          onChange={(e) => setList(e.target.value)}
          rows={18}
          className="w-full rounded-md border border-ink-line bg-ink-soft px-3 py-2 font-mono text-xs outline-none focus:border-tier-gold"
          required
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-tier-gold px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {submitting ? "Resolving cards…" : "Build map"}
      </button>
    </form>
  );
}
