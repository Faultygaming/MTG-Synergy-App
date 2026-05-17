"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SAMPLE = `1 Sol Ring
1 Arcane Signet
1 Cultivate
1 Rampant Growth
1 Llanowar Elves
1 Elvish Mystic
1 Elvish Archdruid
1 Priest of Titania
1 Imperious Perfect
1 Ezuri, Renegade Leader
1 Eternal Witness
1 Reclamation Sage
1 Elvish Visionary
1 Wood Elves
1 Craterhoof Behemoth`;

export function DeckPasteForm() {
  const router = useRouter();
  const [name, setName] = useState("My Synergy Deck");
  const [list, setList] = useState(SAMPLE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, decklist: list }),
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
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-300">
          Decklist
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
