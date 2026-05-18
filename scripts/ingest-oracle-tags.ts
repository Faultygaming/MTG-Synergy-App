/**
 * Apply the precomputed oracle-tag map (seeds/oracle-tags-map.json) to
 * the local DB. Fast and offline — no Scryfall calls.
 *
 *   pnpm ingest:tags
 *
 * The map is built once on a dev machine (or in scheduled CI) via
 * `pnpm tags:build`; this runtime command just reads + applies it. See
 * scripts/tags-build.ts for the network-bound builder.
 *
 * For each Card row in the DB, looks up the precomputed tags by
 * oracle_id and writes them to `oracleTagsJson`. Also re-unions the
 * tags into the card's `keywordsJson` as `otag:*` so the synergy ranker
 * picks them up without a re-extract.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";

interface OracleTagsMap {
  version: 1;
  generatedAt: string | null;
  tagDigests: Record<string, { count: number; digest: string }>;
  cardTags: Record<string, string[]>;
}

// Optional override: `--file <path>` loads a tag-map from anywhere
// (used by validate-scripts.ts to feed a synthetic map without polluting
// the seeds/ directory).
const FILE_FLAG_IDX = process.argv.indexOf("--file");
const FILE_OVERRIDE =
  FILE_FLAG_IDX > -1 ? process.argv[FILE_FLAG_IDX + 1] : null;

async function main() {
  const mapPath = FILE_OVERRIDE
    ? resolve(FILE_OVERRIDE)
    : resolve(process.cwd(), "seeds/oracle-tags-map.json");
  const raw = await readFile(mapPath, "utf8");
  const map = JSON.parse(raw) as OracleTagsMap;

  if (!map.generatedAt || Object.keys(map.cardTags).length === 0) {
    console.log(
      "seeds/oracle-tags-map.json is empty. Run `pnpm tags:build` on a machine with internet access to populate it (see scripts/tags-build.ts).",
    );
    return;
  }

  console.log(
    `Applying tag map generated ${map.generatedAt} (${Object.keys(map.cardTags).length} cards, ${Object.keys(map.tagDigests).length} tags)...`,
  );

  const cardIds = Object.keys(map.cardTags);
  // findMany in chunks so we don't OOM on a 30k corpus.
  const CHUNK = 500;
  let applied = 0;
  let skipped = 0;
  for (let i = 0; i < cardIds.length; i += CHUNK) {
    const ids = cardIds.slice(i, i + CHUNK);
    const cards = await prisma.card.findMany({
      where: { id: { in: ids } },
      select: { id: true, keywordsJson: true },
    });
    const byId = new Map(cards.map((c) => [c.id, c]));
    for (const id of ids) {
      const tags = map.cardTags[id];
      const row = byId.get(id);
      if (!row) {
        skipped += 1;
        continue;
      }
      // Union the otag:* tags into the existing keyword set. Replace
      // any prior otag:* (so removed tags actually disappear), preserve
      // every non-otag keyword (printed mechanics, regex-pack matches,
      // type-line tokens).
      const existingKeywords = JSON.parse(row.keywordsJson) as string[];
      const merged = new Set(
        existingKeywords.filter((k) => !k.startsWith("otag:")),
      );
      for (const t of tags) merged.add(`otag:${t}`);
      await prisma.card.update({
        where: { id },
        data: {
          oracleTagsJson: JSON.stringify(tags.sort()),
          keywordsJson: JSON.stringify(Array.from(merged).sort()),
        },
      });
      applied += 1;
    }
    if (Math.floor((i + CHUNK) / CHUNK) % 10 === 0) {
      console.log(`  ${Math.min(i + CHUNK, cardIds.length)}/${cardIds.length}`);
    }
  }

  console.log(
    `Done. ${applied} cards tagged, ${skipped} skipped (not in local DB — run \`ingest\` first to populate the corpus).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
