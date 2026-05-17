import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import type { CardSummary, DeckEntry, SynergySuggestion } from "@/lib/types";
import { rankCandidates, topThreeKeywords } from "@/lib/synergy/score";
import { DeckSidebar } from "@/components/DeckSidebar";
import { SynergyMap } from "@/components/SynergyMap";
import {
  formatViolation,
  isCandidateLegal,
  DEFAULT_CONFIG,
  type CommanderLegalityCard,
  type CommanderRulesConfig,
  type Violation,
} from "@/lib/commander/rules";
import { RulesConfigPanel } from "@/components/RulesConfigPanel";

interface CardRow {
  id: string;
  name: string;
  typeLine: string;
  manaCost: string | null;
  colors: string;
  colorIdentity: string;
  oracleText: string | null;
  imageSmall: string | null;
  imageNormal: string | null;
  scryfallUri: string | null;
  keywordsJson: string;
}

function rowToSummary(r: CardRow): CardSummary {
  return {
    id: r.id,
    name: r.name,
    typeLine: r.typeLine,
    manaCost: r.manaCost,
    colors: JSON.parse(r.colors) as string[],
    imageSmall: r.imageSmall,
    imageNormal: r.imageNormal,
    scryfallUri: r.scryfallUri,
    keywords: JSON.parse(r.keywordsJson) as string[],
  };
}

function rowToLegality(r: CardRow): CommanderLegalityCard {
  return {
    ...rowToSummary(r),
    colorIdentity: JSON.parse(r.colorIdentity) as string[],
    oracleText: r.oracleText,
  };
}

export default async function DeckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 16 made dynamic route params async — must await before use.
  const { id } = await params;
  const deck = await prisma.deck.findUnique({
    where: { id },
    include: {
      cards: { include: { card: true } },
    },
  });
  if (!deck) notFound();

  const cardRows = deck.cards.map((dc) => dc.card as unknown as CardRow);
  const entries: DeckEntry[] = deck.cards.map((dc) => ({
    card: rowToSummary(dc.card as unknown as CardRow),
    quantity: dc.quantity,
  }));

  // Look up commanders separately so they don't double-count in the mainboard graph.
  const commanderIds = [deck.commanderId, deck.partnerId].filter(Boolean) as string[];
  const commanderRows = commanderIds.length
    ? ((await prisma.card.findMany({
        where: { id: { in: commanderIds } },
      })) as unknown as CardRow[])
    : [];
  const commanders: CommanderLegalityCard[] = commanderRows.map(rowToLegality);

  const top = topThreeKeywords(entries);
  const violations = JSON.parse(deck.violationsJson) as Violation[];
  const blockers = violations.filter((v) => v.severity === "block");
  const warnings = violations.filter((v) => v.severity === "warn");
  const rulesConfig: CommanderRulesConfig = {
    ...DEFAULT_CONFIG,
    ...(JSON.parse(deck.rulesConfigJson || "{}") as Partial<CommanderRulesConfig>),
  };

  // Candidate pool: every card in the DB that's not already in the deck
  // AND is legal in the commander's color identity (banned / out-of-CI filtered).
  const inDeckIds = new Set([
    ...entries.map((e) => e.card.id),
    ...commanderIds,
  ]);
  const candidateRows = (await prisma.card.findMany({
    where: { id: { notIn: Array.from(inDeckIds) } },
    take: 2000,
  })) as unknown as CardRow[];

  const candidates: CardSummary[] = [];
  for (const row of candidateRows) {
    const legality = rowToLegality(row);
    if (
      deck.format === "commander" &&
      !isCandidateLegal(legality, commanders, rulesConfig)
    ) {
      continue;
    }
    candidates.push(rowToSummary(row));
  }
  const suggestions: SynergySuggestion[] = rankCandidates(candidates, entries).slice(0, 60);

  return (
    <main className="grid min-h-screen grid-cols-[1fr_380px]">
      <section className="flex flex-col">
        <header className="border-b border-ink-line px-6 py-3">
          <div className="flex items-baseline justify-between">
            <div>
              <h1 className="text-lg font-semibold">
                {deck.name}{" "}
                <span className="ml-2 rounded bg-ink-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-400">
                  {deck.format}
                </span>
              </h1>
              <p className="text-xs text-stone-500">
                {commanders.length > 0 && (
                  <>
                    cmd:&nbsp;
                    <span className="text-tier-gold">
                      {commanders.map((c) => c.name).join(" + ")}
                    </span>{" "}
                    ·{" "}
                  </>
                )}
                {entries.length} cards · primary&nbsp;
                <span className="text-tier-gold">{top.primary ?? "—"}</span> ·
                secondary&nbsp;
                <span className="text-tier-silver">{top.secondary ?? "—"}</span> ·
                tertiary&nbsp;
                <span className="text-tier-bronze">{top.tertiary ?? "—"}</span>
              </p>
            </div>
            <Link
              href="/deck/new"
              className="text-xs text-stone-400 underline-offset-2 hover:underline"
            >
              new deck
            </Link>
          </div>
          {blockers.length > 0 && (
            <div className="mt-3 rounded border border-red-900/60 bg-red-950/40 p-2 text-xs text-red-300">
              <div className="mb-1 font-semibold uppercase tracking-wider text-red-200">
                Blocking violations ({blockers.length})
              </div>
              <ul className="ml-4 list-disc space-y-0.5">
                {blockers.slice(0, 6).map((v, i) => (
                  <li key={i}>{formatViolation(v)}</li>
                ))}
                {blockers.length > 6 && (
                  <li className="text-red-400/70">
                    …and {blockers.length - 6} more
                  </li>
                )}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="mt-2 rounded border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200">
              <div className="mb-1 font-semibold uppercase tracking-wider text-amber-100">
                Warnings ({warnings.length})
              </div>
              <ul className="ml-4 list-disc space-y-0.5">
                {warnings.slice(0, 6).map((v, i) => (
                  <li key={i}>{formatViolation(v)}</li>
                ))}
                {warnings.length > 6 && (
                  <li className="text-amber-400/70">
                    …and {warnings.length - 6} more
                  </li>
                )}
              </ul>
            </div>
          )}
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-stone-500 hover:text-stone-300">
              Rules settings
            </summary>
            <div className="mt-2 rounded border border-ink-line bg-ink/40 p-3">
              <RulesConfigPanel deckId={deck.id} initial={rulesConfig} />
            </div>
          </details>
        </header>
        <div className="relative min-h-0 flex-1">
          <SynergyMap entries={entries} top={top} />
        </div>
      </section>
      <aside className="border-l border-ink-line bg-ink-soft">
        <DeckSidebar suggestions={suggestions} />
      </aside>
    </main>
  );
}
