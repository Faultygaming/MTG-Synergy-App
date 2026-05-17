import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
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

// PATCH /api/decks/[id]/rules
//
// Updates the per-deck Commander rules config and re-validates the deck
// against the new severities. Returns the freshly-computed violation list.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Next 16 made route handler params async — must await before use.
  const { id } = await params;

  let body: z.infer<typeof RulesConfigSchema>;
  try {
    body = RulesConfigSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid config" },
      { status: 400 },
    );
  }

  const existing = await prisma.deck.findUnique({
    where: { id },
    include: { cards: { include: { card: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }
  const deckId = id;

  const oldConfig: CommanderRulesConfig = {
    ...DEFAULT_CONFIG,
    ...(JSON.parse(existing.rulesConfigJson || "{}") as Partial<CommanderRulesConfig>),
  };
  const config: CommanderRulesConfig = { ...oldConfig, ...body };

  // Re-validate. Need to assemble the commander + 99 in the legality shape.
  const commanderIds = [existing.commanderId, existing.partnerId].filter(Boolean) as string[];
  const commanderRows = commanderIds.length
    ? await prisma.card.findMany({ where: { id: { in: commanderIds } } })
    : [];
  const toLegality = (r: typeof commanderRows[number]): CommanderLegalityCard => ({
    id: r.id,
    name: r.name,
    typeLine: r.typeLine,
    manaCost: r.manaCost,
    colors: JSON.parse(r.colors) as string[],
    colorIdentity: JSON.parse(r.colorIdentity) as string[],
    oracleText: r.oracleText,
    imageSmall: r.imageSmall,
    imageNormal: r.imageNormal,
    scryfallUri: r.scryfallUri,
    keywords: JSON.parse(r.keywordsJson) as string[],
  });

  const violations = validateCommanderDeck(
    {
      commanders: commanderRows.map(toLegality),
      cards: existing.cards.map((dc) => ({
        card: toLegality(dc.card),
        quantity: dc.quantity,
      })),
    },
    config,
  );

  await prisma.deck.update({
    where: { id: deckId },
    data: {
      rulesConfigJson: JSON.stringify(config),
      violationsJson: JSON.stringify(violations),
    },
  });

  return NextResponse.json({ config, violations });
}
