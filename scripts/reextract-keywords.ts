/**
 * Re-extract the `keywordsJson` field for every Card row in the local
 * DB using the CURRENT extractKeywords logic, without re-downloading
 * anything from Scryfall. Run this after pulling an update that
 * changes the regex pack or stoplist so existing rows pick up the
 * new patterns.
 *
 *   pnpm reextract-keywords
 *
 * `producedManaJson` is persisted on the Card row, so mana-fixing /
 * mana-rock / produces-* are recomputed accurately. The raw Scryfall
 * `keywords[]` array (Flying, Vigilance, Haste, …) isn't stored, so
 * those tags are carried forward from the existing keywordsJson.
 *
 * For a full clean rebuild (refresh printed keywords from Scryfall too),
 * use `ingest --force` instead.
 */
import { prisma } from "../src/lib/db";
import { extractKeywords } from "../src/lib/synergy/keywords";

// Prefixed tags we never re-derive — they come from data sources
// extractKeywords doesn't have access to during reextract:
//   - otag:* — Scryfall oracle tags (loaded by `ingest:tags`)
//   - everything else is recomputable.
const PRESERVED_PREFIXES = ["otag:"];

async function main() {
  const all = await prisma.card.findMany({
    select: {
      id: true,
      typeLine: true,
      oracleText: true,
      keywordsJson: true,
      oracleTagsJson: true,
      producedManaJson: true,
    },
  });
  console.log(`Re-extracting keywords for ${all.length} cards...`);
  let updated = 0;
  let unchanged = 0;
  for (const c of all) {
    const existing = JSON.parse(c.keywordsJson) as string[];
    const oracleTags = JSON.parse(c.oracleTagsJson) as string[];
    const producedMana = JSON.parse(c.producedManaJson) as string[];
    // Carry forward printed-keyword tags (we don't store the raw
    // Scryfall keywords[] array, so they have to come from existing rows).
    const carried = existing.filter((k) =>
      PRESERVED_PREFIXES.some((p) => k.startsWith(p)),
    );
    const recomputed = extractKeywords(
      {
        keywords: [],
        type_line: c.typeLine,
        oracle_text: c.oracleText ?? "",
        produced_mana: producedMana,
      },
      oracleTags,
    );
    const merged = Array.from(new Set([...recomputed, ...carried])).sort();
    const oldSorted = [...existing].sort();
    if (
      merged.length === oldSorted.length &&
      merged.every((v, i) => v === oldSorted[i])
    ) {
      unchanged += 1;
      continue;
    }
    await prisma.card.update({
      where: { id: c.id },
      data: { keywordsJson: JSON.stringify(merged) },
    });
    updated += 1;
    if (updated % 500 === 0) console.log(`  ${updated} updated so far...`);
  }
  console.log(
    `Done. ${updated} cards updated, ${unchanged} unchanged. Tip: run \`ingest --force\` for a full refresh that re-fetches printed-keyword data from Scryfall.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
