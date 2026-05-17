import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-start gap-8 px-6 py-16">
      <header className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight text-tier-gold">
          MTG Synergy Map
        </h1>
        <p className="max-w-2xl text-stone-400">
          Paste a decklist and explore it as a word map of shared keywords.
          Cards that lock onto your deck&apos;s primary, secondary and tertiary
          synergy patterns are surfaced with gold, silver and bronze borders.
        </p>
      </header>

      <Link
        href="/deck/new"
        className="rounded-md bg-tier-gold px-5 py-2.5 font-semibold text-ink hover:brightness-110"
      >
        Start a new deck →
      </Link>

      <section className="mt-8 grid w-full grid-cols-1 gap-4 text-sm md:grid-cols-3">
        <div className="rounded-lg border border-ink-line bg-ink-soft p-4">
          <div className="mb-1 font-semibold text-tier-gold">Gold</div>
          <p className="text-stone-400">
            Shares your deck&apos;s #1 most-used keyword.
          </p>
        </div>
        <div className="rounded-lg border border-ink-line bg-ink-soft p-4">
          <div className="mb-1 font-semibold text-tier-silver">Silver</div>
          <p className="text-stone-400">
            Shares your deck&apos;s #2 keyword, but not the primary.
          </p>
        </div>
        <div className="rounded-lg border border-ink-line bg-ink-soft p-4">
          <div className="mb-1 font-semibold text-tier-bronze">Bronze</div>
          <p className="text-stone-400">
            Shares your #3 keyword. Ranking within tier is by overlap count.
          </p>
        </div>
      </section>
    </main>
  );
}
