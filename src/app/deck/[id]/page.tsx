import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import type {
  CardSummary,
  DeckEntry,
  RemovalCandidate,
  SynergySuggestion,
} from "@/lib/types";
import { rankCandidates, topThreeKeywords } from "@/lib/synergy/score";
import {
  detectDeckThemes,
  scoreDeckCardsForRemoval,
  THEMES,
} from "@/lib/synergy/themes";
import type { MapTheme } from "@/lib/synergy/map";
import { COMMON_KEYWORD_STOPLIST } from "@/lib/synergy/stoplist";
import { DeckSidebar } from "@/components/DeckSidebar";
import { SynergyMap } from "@/components/SynergyMap";
import { RemovalPanel } from "@/components/RemovalPanel";
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

  // Apply the common-keyword stoplist so the header reflects actual
  // synergy themes ("landfall", "ramp", "etb-trigger") instead of
  // trivia ("creature", "land"). The SynergyMap re-derives the same
  // top-3 client-side with the same stoplist by default; a toggle lets
  // the user bring common words back if they want.
  const top = topThreeKeywords(entries, COMMON_KEYWORD_STOPLIST);
  const violations = JSON.parse(deck.violationsJson) as Violation[];
  const blockers = violations.filter((v) => v.severity === "block");
  const warnings = violations.filter((v) => v.severity === "warn");
  const rulesConfig: CommanderRulesConfig = {
    ...DEFAULT_CONFIG,
    ...(JSON.parse(deck.rulesConfigJson || "{}") as Partial<CommanderRulesConfig>),
  };

  // Candidate pool: every card in the DB that's not already in the deck
  // AND is legal in the commander's color identity (banned / out-of-CI filtered).
  // No take cap — the synergy ranker is fast enough to score the full
  // corpus on render, and capping at 2000 missed deep-pool synergies
  // like Crucible of Worlds for land-recursion decks.
  const inDeckIds = new Set([
    ...entries.map((e) => e.card.id),
    ...commanderIds,
  ]);
  const candidateRows = (await prisma.card.findMany({
    where: { id: { notIn: Array.from(inDeckIds) } },
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
  // Detect the deck's primary archetype themes (lands-matter, aristocrats,
  // spellslinger, …). Threaded through rankCandidates so each suggestion
  // gets a theme-derived tier + rationale ("Your deck has 8 enablers
  // but only 1 payoff — this closes the loop") instead of the older
  // raw keyword-overlap tier. See src/lib/synergy/themes.ts.
  const deckThemes = detectDeckThemes(entries);
  // Project deck themes into the map's serializable shape. The map
  // module is keyword-pure (no theme catalog dependency), so we hand
  // it the resolved member-with-role lists per active theme.
  const mapThemes: MapTheme[] = deckThemes.map((dt) => {
    const cat = THEMES.find((t) => t.id === dt.themeId);
    return {
      themeId: dt.themeId,
      members: cat?.members ?? [],
      totalCount: dt.totalCount,
    };
  });
  const suggestions: SynergySuggestion[] = rankCandidates(
    candidates,
    entries,
    COMMON_KEYWORD_STOPLIST,
    deckThemes,
  ).slice(0, 100);
  // Removal panel: cards in the deck that match 0 of the deck's primary
  // themes — these are the first cuts when making room.
  const removalCandidates: RemovalCandidate[] = scoreDeckCardsForRemoval(
    entries,
    deckThemes,
  ).filter((r) => r.themesMatched === 0);

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
                {entries.length} cards
                {deckThemes.length > 0 && (
                  <>
                    {" "}· themes&nbsp;
                    {deckThemes.slice(0, 3).map((t, i) => (
                      <span key={t.themeId}>
                        {i > 0 && <span className="text-stone-600"> · </span>}
                        <span className="text-tier-gold">{t.themeLabel}</span>
                        <span className="text-stone-500"> ({t.totalCount})</span>
                      </span>
                    ))}
                  </>
                )}
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
          <SynergyMap entries={entries} themes={mapThemes} />
        </div>
      </section>
      <aside className="flex flex-col border-l border-ink-line bg-ink-soft">
        <div className="flex-1 overflow-hidden">
          <DeckSidebar suggestions={suggestions} deckId={deck.id} />
        </div>
        {removalCandidates.length > 0 && (
          <RemovalPanel candidates={removalCandidates} />
        )}
      </aside>
    </main>
  );
}
