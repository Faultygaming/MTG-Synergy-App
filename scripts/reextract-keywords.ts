/**
 * Re-extract the `keywordsJson` field for every Card row in the local
 * DB using the CURRENT extractKeywords logic, without re-downloading
 * anything from Scryfall. Run this after pulling an update that
 * changes the regex pack or stoplist so existing rows pick up the
 * new patterns.
 *
 *   pnpm reextract-keywords
 *
 * What it does NOT have access to (since we don't store the raw
 * Scryfall payload): the printed `keywords[]` array and `produced_mana`
 * array. Those parts of the keyword set are preserved from the existing
 * row's `keywordsJson` — anything that LOOKS like a printed keyword
 * (lower-kebab of a known mechanic) or a produces-* tag is carried
 * forward; the regex-pack and type-line tokens are recomputed.
 *
 * For a full clean rebuild (refresh printed keywords + produced_mana
 * too), use `ingest --force` instead — that fetches the fresh Scryfall
 * data.
 */
import { prisma } from "../src/lib/db";
import { extractKeywords } from "../src/lib/synergy/keywords";

// Heuristic for "looks like a printed keyword or produces-* tag":
// short lowercase token, no spaces, present in the existing keyword
// set but not derived from oracle text by the regex pack.
const PRESERVED_PREFIXES = ["otag:", "produces-"];

async function main() {
  const all = await prisma.card.findMany({
    select: {
      id: true,
      typeLine: true,
      oracleText: true,
      keywordsJson: true,
      oracleTagsJson: true,
    },
  });
  console.log(`Re-extracting keywords for ${all.length} cards...`);
  let updated = 0;
  let unchanged = 0;
  for (const c of all) {
    const existing = JSON.parse(c.keywordsJson) as string[];
    const oracleTags = JSON.parse(c.oracleTagsJson) as string[];
    // Carry forward fields we can't recompute from the DB row.
    const carried = existing.filter((k) =>
      PRESERVED_PREFIXES.some((p) => k.startsWith(p)),
    );
    // Re-derive everything we CAN compute from oracle_text + type_line.
    // Printed `keywords[]` from Scryfall is unavailable here; if it's
    // missing, run `ingest --force` to refresh from the bulk.
    const recomputed = extractKeywords(
      {
        keywords: [],
        type_line: c.typeLine,
        oracle_text: c.oracleText ?? "",
        produced_mana: [],
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
