import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

// POST   /api/decks/[id]/cards/[cardId] — add 1 copy to the deck.
// DELETE /api/decks/[id]/cards/[cardId] — remove 1 copy (deletes the
//                                          row when the last copy goes).
//
// Both endpoints idempotently update the DeckCard quantity field and
// revalidate the deck page so server-rendered suggestions/themes
// reflect the new contents on the next render.
//
// Validation:
//   - Returns 404 if the deck or card doesn't exist.
//   - DELETE on a card not in the deck is a no-op (returns the
//     current 0 quantity).
//   - No quantity-from-body — single-copy moves only. Bulk-add stays
//     in the paste-decklist flow at POST /api/decks.

interface RouteContext {
  params: Promise<{ id: string; cardId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  const { id, cardId } = await params;
  const [deck, card] = await Promise.all([
    prisma.deck.findUnique({ where: { id }, select: { id: true } }),
    prisma.card.findUnique({ where: { id: cardId }, select: { id: true } }),
  ]);
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const existing = await prisma.deckCard.findUnique({
    where: { deckId_cardId: { deckId: id, cardId } },
  });
  const quantity = (existing?.quantity ?? 0) + 1;
  await prisma.deckCard.upsert({
    where: { deckId_cardId: { deckId: id, cardId } },
    create: { deckId: id, cardId, quantity: 1 },
    update: { quantity },
  });

  revalidatePath(`/deck/${id}`);
  return NextResponse.json({ deckId: id, cardId, quantity });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id, cardId } = await params;
  const existing = await prisma.deckCard.findUnique({
    where: { deckId_cardId: { deckId: id, cardId } },
  });
  if (!existing) {
    // Already not in deck — succeed quietly so the UI's optimistic
    // mutation doesn't error on a double-click.
    return NextResponse.json({ deckId: id, cardId, quantity: 0 });
  }
  const next = existing.quantity - 1;
  if (next <= 0) {
    await prisma.deckCard.delete({
      where: { deckId_cardId: { deckId: id, cardId } },
    });
  } else {
    await prisma.deckCard.update({
      where: { deckId_cardId: { deckId: id, cardId } },
      data: { quantity: next },
    });
  }
  revalidatePath(`/deck/${id}`);
  return NextResponse.json({ deckId: id, cardId, quantity: Math.max(0, next) });
}
