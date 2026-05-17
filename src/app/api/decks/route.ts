import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseDecklist } from "@/lib/decklist";
import { getCardByName, toCardSummary, type ScryfallCard } from "@/lib/scryfall";
import { extractKeywords } from "@/lib/synergy/keywords";
import { extractDeckId, importMoxfieldDeck } from "@/lib/moxfield";
import {
  validateCommanderDeck,
  type CommanderLegalityCard,
} from "@/lib/commander/rules";

const BodySchema = z.union([
  z.object({
    kind: z.literal("paste"),
    name: z.string().min(1).max(120),
    decklist: z.string().min(1).max(50_000),
    commanders: z.array(z.string().min(1)).max(2).optional(),
  }),
  z.object({
    kind: z.literal("moxfield"),
    url: z.string().min(1).max(500),
  }),
]);

type Resolved = { cardId: string; quantity: number; card: CommanderLegalityCard };

async function ensureCardInDb(name: string): Promise<Resolved | null> {
  let card = await prisma.card.findUnique({ where: { name } });
  if (!card) {
    const sc = await getCardByName(name);
    if (!sc) return null;
    card = await upsertScryfallCard(sc);
  }
  return {
    cardId: card.id,
    quantity: 1,
    card: rowToLegalityCard(card),
  };
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
  const keywords = extractKeywords({
    keywords: sc.keywords ?? [],
    type_line: sc.type_line,
    oracle_text: sc.oracle_text ?? "",
    produced_mana: sc.produced_mana ?? [],
  });
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

  const missing: string[] = [];

  // Resolve commanders.
  const commanderCards: CommanderLegalityCard[] = [];
  const commanderIds: string[] = [];
  for (const cn of commanderNames) {
    const r = await ensureCardInDb(cn);
    if (!r) {
      missing.push(cn);
      continue;
    }
    commanderCards.push(r.card);
    commanderIds.push(r.cardId);
  }

  // Resolve mainboard.
  const resolved: Resolved[] = [];
  for (const line of lines) {
    let card = await prisma.card.findUnique({ where: { name: line.name } });
    if (!card) {
      const sc = await getCardByName(line.name);
      if (!sc) {
        missing.push(line.name);
        continue;
      }
      card = await upsertScryfallCard(sc);
    }
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

  // Validate against Commander rules (only when format is commander).
  const violations =
    format === "commander"
      ? validateCommanderDeck({
          commanders: commanderCards,
          cards: resolved.map((r) => ({ card: r.card, quantity: r.quantity })),
        })
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
      cards: {
        create: Array.from(merged, ([cardId, quantity]) => ({ cardId, quantity })),
      },
    },
  });

  return NextResponse.json({ id: deck.id, missing, violations });
}
