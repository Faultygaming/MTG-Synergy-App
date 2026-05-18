import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseDecklist } from "@/lib/decklist";
import {
  getCardsByNames,
  toCardSummary,
  type ScryfallCard,
} from "@/lib/scryfall";
import { extractKeywords } from "@/lib/synergy/keywords";
import { extractDeckId, importMoxfieldDeck } from "@/lib/moxfield";
import {
  validateCommanderDeck,
  DEFAULT_CONFIG,
  type CommanderLegalityCard,
  type CommanderRulesConfig,
} from "@/lib/commander/rules";

const RuleSeveritySchema = z.enum(["off", "warn", "block"]);
const RulesConfigSchema = z.object({
  deckSize: RuleSeveritySchema.optional(),
  singleton: RuleSeveritySchema.optional(),
  colorIdentity: RuleSeveritySchema.optional(),
  banlist: RuleSeveritySchema.optional(),
  commanderLegality: RuleSeveritySchema.optional(),
  globalMode: z.enum(["strict", "warn"]).optional(),
});

const BodySchema = z.union([
  z.object({
    kind: z.literal("paste"),
    name: z.string().min(1).max(120),
    decklist: z.string().min(1).max(50_000),
    commanders: z.array(z.string().min(1)).max(2).optional(),
    rulesConfig: RulesConfigSchema.optional(),
  }),
  z.object({
    kind: z.literal("moxfield"),
    url: z.string().min(1).max(500),
    rulesConfig: RulesConfigSchema.optional(),
  }),
]);

type Resolved = { cardId: string; quantity: number; card: CommanderLegalityCard };

// Bulk-resolve a flat list of card names. Single round-trip to Scryfall
// per 75 names instead of one per card. Cards already in the local DB
// are reused without any network call; only the unknown ones hit
// Scryfall via the collection endpoint.
//
// Returns a Map keyed by the canonical Scryfall card name so callers can
// look up by their pasted-in name (case-insensitive collation handled
// by SQLite's NOCASE collation on the unique index — see schema.prisma).
async function resolveCardsByName(
  names: string[],
): Promise<{ byName: Map<string, Awaited<ReturnType<typeof prisma.card.findUnique>>>; missing: string[] }> {
  const unique = Array.from(new Set(names));
  if (unique.length === 0) return { byName: new Map(), missing: [] };

  // First pass: look up everything in one DB query.
  const existing = await prisma.card.findMany({
    where: { name: { in: unique } },
  });
  const byName = new Map<string, Awaited<ReturnType<typeof prisma.card.findUnique>>>();
  for (const c of existing) byName.set(c.name, c);

  // Second pass: anything we still don't have, bulk-fetch from Scryfall.
  const missingFromDb = unique.filter((n) => !byName.has(n));
  const missing: string[] = [];
  if (missingFromDb.length > 0) {
    let fetched: { found: ScryfallCard[]; notFound: string[] };
    try {
      fetched = await getCardsByNames(missingFromDb);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Scryfall lookup failed",
      );
    }
    for (const sc of fetched.found) {
      const row = await upsertScryfallCard(sc);
      byName.set(row.name, row);
      // Also map the original requested name (Scryfall normalizes
      // casing & punctuation, so the user's "lightning bolt" lookup
      // would otherwise miss).
      const requested = missingFromDb.find(
        (n) => n.toLowerCase() === sc.name.toLowerCase(),
      );
      if (requested && requested !== sc.name) byName.set(requested, row);
    }
    missing.push(...fetched.notFound);
  }
  return { byName, missing };
}

function rowToLegalityCard(card: {
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
}): CommanderLegalityCard {
  return {
    id: card.id,
    name: card.name,
    typeLine: card.typeLine,
    manaCost: card.manaCost,
    colors: JSON.parse(card.colors) as string[],
    colorIdentity: JSON.parse(card.colorIdentity) as string[],
    oracleText: card.oracleText,
    imageSmall: card.imageSmall,
    imageNormal: card.imageNormal,
    scryfallUri: card.scryfallUri,
    keywords: JSON.parse(card.keywordsJson) as string[],
  };
}

async function upsertScryfallCard(sc: ScryfallCard) {
  const summary = toCardSummary(sc);
  // Preserve any previously-ingested oracle tags (from `pnpm ingest:tags`).
  const existing = await prisma.card.findUnique({
    where: { id: summary.id },
    select: { oracleTagsJson: true },
  });
  const oracleTags = existing
    ? (JSON.parse(existing.oracleTagsJson) as string[])
    : [];
  const keywords = extractKeywords(
    {
      keywords: sc.keywords ?? [],
      type_line: sc.type_line,
      oracle_text: sc.oracle_text ?? "",
      produced_mana: sc.produced_mana ?? [],
    },
    oracleTags,
  );
  return prisma.card.upsert({
    where: { id: summary.id },
    create: {
      id: summary.id,
      name: summary.name,
      manaCost: summary.manaCost ?? null,
      cmc: sc.cmc ?? null,
      typeLine: summary.typeLine,
      oracleText: sc.oracle_text ?? null,
      colors: JSON.stringify(summary.colors),
      colorIdentity: JSON.stringify(sc.color_identity ?? []),
      power: sc.power ?? null,
      toughness: sc.toughness ?? null,
      keywordsJson: JSON.stringify(keywords),
      oracleTagsJson: JSON.stringify(oracleTags),
      imageSmall: summary.imageSmall ?? null,
      imageNormal: summary.imageNormal ?? null,
      scryfallUri: summary.scryfallUri ?? null,
      edhrecRank: sc.edhrec_rank ?? null,
    },
    update: {
      keywordsJson: JSON.stringify(keywords),
      colorIdentity: JSON.stringify(sc.color_identity ?? []),
      oracleText: sc.oracle_text ?? null,
    },
  });
}

// POST /api/decks
// Two import modes:
//   { kind: "paste", name, decklist, commanders? }  // commanders[] is a name list (1 or 2)
//   { kind: "moxfield", url }                       // fetches from Moxfield's public API
//
// Commander rules are validated post-resolve. Violations are returned in the
// response *and* persisted on the Deck row, so the UI can surface them.
export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request" },
      { status: 400 },
    );
  }

  let deckName: string;
  let format: string;
  let commanderNames: string[];
  let lines: Array<{ name: string; quantity: number }>;

  if (body.kind === "paste") {
    deckName = body.name;
    format = "commander";
    commanderNames = body.commanders ?? [];
    lines = parseDecklist(body.decklist);
  } else {
    if (!extractDeckId(body.url)) {
      return NextResponse.json({ error: "Not a valid Moxfield URL." }, { status: 400 });
    }
    try {
      const imp = await importMoxfieldDeck(body.url);
      deckName = imp.name;
      format = imp.format;
      commanderNames = imp.commanders;
      lines = imp.cards;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Moxfield import failed" },
        { status: 502 },
      );
    }
  }

  if (lines.length === 0 && commanderNames.length === 0) {
    return NextResponse.json({ error: "Decklist is empty." }, { status: 400 });
  }

  // Bulk-resolve ALL names (commanders + mainboard) in a single pass.
  // This collapses ~100 sequential Scryfall calls into 2 (one per 75-card
  // chunk), which is what keeps a 99-card-deck paste under the rate limit.
  const allNames = [...commanderNames, ...lines.map((l) => l.name)];
  let resolution: { byName: Map<string, Awaited<ReturnType<typeof prisma.card.findUnique>>>; missing: string[] };
  try {
    resolution = await resolveCardsByName(allNames);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Card lookup failed" },
      { status: 502 },
    );
  }
  const { byName, missing } = resolution;

  // Commanders.
  const commanderCards: CommanderLegalityCard[] = [];
  const commanderIds: string[] = [];
  for (const cn of commanderNames) {
    const card = byName.get(cn);
    if (!card) continue; // already accounted for in `missing`
    commanderCards.push(rowToLegalityCard(card));
    commanderIds.push(card.id);
  }

  // Mainboard.
  const resolved: Resolved[] = [];
  for (const line of lines) {
    const card = byName.get(line.name);
    if (!card) continue; // already in `missing`
    resolved.push({
      cardId: card.id,
      quantity: line.quantity,
      card: rowToLegalityCard(card),
    });
  }

  if (resolved.length === 0 && commanderCards.length === 0) {
    return NextResponse.json(
      { error: "Couldn't resolve any cards.", missing },
      { status: 400 },
    );
  }

  // Per-deck rule severities, merged with the engine defaults.
  const rulesConfig: CommanderRulesConfig = {
    ...DEFAULT_CONFIG,
    ...(body.rulesConfig ?? {}),
  };

  // Validate against Commander rules (only when format is commander).
  const violations =
    format === "commander"
      ? validateCommanderDeck(
          {
            commanders: commanderCards,
            cards: resolved.map((r) => ({ card: r.card, quantity: r.quantity })),
          },
          rulesConfig,
        )
      : [];

  // Merge duplicate cardIds into a single DeckCard row (commander uses
  // singleton; this still works for paste-mode multi-line entries of basics).
  const merged = new Map<string, number>();
  for (const r of resolved) merged.set(r.cardId, (merged.get(r.cardId) ?? 0) + r.quantity);

  const deck = await prisma.deck.create({
    data: {
      name: deckName,
      format,
      commanderId: commanderIds[0] ?? null,
      partnerId: commanderIds[1] ?? null,
      violationsJson: JSON.stringify(violations),
      rulesConfigJson: JSON.stringify(rulesConfig),
      cards: {
        create: Array.from(merged, ([cardId, quantity]) => ({ cardId, quantity })),
      },
    },
  });

  return NextResponse.json({ id: deck.id, missing, violations });
}
