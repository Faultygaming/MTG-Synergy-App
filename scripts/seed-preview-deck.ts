/**
 * Internal helper: builds a test deck from the seeded fixtures so
 * scripts/preview-map.ts has something to render against. Not part of
 * the user-facing CLI; used only when self-validating SynergyMap changes
 * from a sandbox without browser/Scryfall access.
 *
 * Usage:
 *   pnpm tsx scripts/seed-preview-deck.ts
 *   # prints the new deck id; feed it to scripts/preview-map.ts.
 */
import { prisma } from "../src/lib/db";

async function main() {
  const cards = await prisma.card.findMany();
  if (cards.length === 0) {
    console.error("No cards in DB — run `pnpm seed` first.");
    process.exit(1);
  }
  // Wipe any prior preview deck so re-running is idempotent.
  await prisma.deck.deleteMany({ where: { name: "preview-deck" } });
  const cmdId = cards.find((c) => c.typeLine.includes("Legendary"))?.id ?? cards[0].id;
  const ninetynine = cards.filter((c) => c.id !== cmdId).slice(0, 99);
  const deck = await prisma.deck.create({
    data: {
      name: "preview-deck",
      format: "commander",
      commanderId: cmdId,
      cards: {
        create: ninetynine.map((c) => ({ cardId: c.id, quantity: 1 })),
      },
    },
  });
  console.log(deck.id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
