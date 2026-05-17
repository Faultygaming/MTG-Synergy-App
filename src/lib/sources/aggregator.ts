// Card-data aggregator.
//
// Calls every registered source in priority order (lowest first), then merges
// their results into a single `MergedCard`. Merge policy:
//   - Core fields (name, typeLine, oracleText, manaCost, cmc, colors,
//     colorIdentity, images, scryfallUri): first-non-empty wins. This is
//     deliberate — Scryfall is the highest-priority source and its values
//     are authoritative for printed text and images.
//   - Arrays (printedKeywords, oracleTags): unioned across all sources.
//   - Source-specific numeric fields (edhrecRank, edhrecSynergy): first-set wins.
//
// Sources are skipped silently if they fail (network error, source down).
// The aggregator never throws as long as at least one source returns data;
// callers that need strict guarantees should check `.sources` length.

import type { CardSource, MergedCard, SourceCard } from "./types";
import { scryfallSource } from "./scryfall";
import { mtgjsonSource } from "./mtgjson";
import { edhrecSource } from "./edhrec";

// Registry. Order doesn't matter — sorted by `priority` at fetch time.
// Sources can be toggled off by removing them from this array; eventually
// we'll move this behind an env-driven config.
//
// Note: the Scryfall Tagger isn't a runtime source. Oracle tags live on the
// Card row (`oracleTagsJson`) once `pnpm ingest:tags` has populated them,
// and `extractKeywords()` unions them into the keyword set at extract time.
// See scripts/ingest-oracle-tags.ts for the pipeline.
const SOURCES: CardSource[] = [scryfallSource, mtgjsonSource, edhrecSource];

function firstString(...values: Array<string | undefined>): string | undefined {
  for (const v of values) if (v && v.length > 0) return v;
  return undefined;
}

function firstArray<T>(...values: Array<T[] | undefined>): T[] | undefined {
  for (const v of values) if (v && v.length > 0) return v;
  return undefined;
}

function unionArrays<T>(values: Array<T[] | undefined>): T[] {
  const out = new Set<T>();
  for (const v of values) {
    if (!v) continue;
    for (const x of v) out.add(x);
  }
  return Array.from(out);
}

export async function resolveCard(name: string): Promise<MergedCard | null> {
  const ordered = [...SOURCES].sort((a, b) => a.priority - b.priority);

  // Fan out: ask every source in parallel; the priority order matters only
  // for which value wins in the merge.
  const results = await Promise.all(
    ordered.map(async (s): Promise<SourceCard | null> => {
      try {
        return await s.fetchByName(name);
      } catch (err) {
        // Don't let one bad source poison the result.
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[sources/${s.name}] ${(err as Error).message}`);
        }
        return null;
      }
    }),
  );

  // Keep results in priority order so first-non-empty wins reflects priority.
  const hits = results
    .map((r, i) => ({ r, source: ordered[i] }))
    .filter((x): x is { r: SourceCard; source: CardSource } => x.r !== null);

  if (hits.length === 0) return null;

  const merged: MergedCard = {
    name: firstString(...hits.map((h) => h.r.name)) ?? name,
    typeLine: firstString(...hits.map((h) => h.r.typeLine)) ?? "",
    oracleText: firstString(...hits.map((h) => h.r.oracleText)),
    manaCost: firstString(...hits.map((h) => h.r.manaCost)),
    cmc: hits.find((h) => typeof h.r.cmc === "number")?.r.cmc,
    colors: firstArray(...hits.map((h) => h.r.colors)) ?? [],
    colorIdentity: firstArray(...hits.map((h) => h.r.colorIdentity)) ?? [],
    printedKeywords: unionArrays(hits.map((h) => h.r.printedKeywords)),
    imageSmall: firstString(...hits.map((h) => h.r.imageSmall)),
    imageNormal: firstString(...hits.map((h) => h.r.imageNormal)),
    scryfallUri: firstString(...hits.map((h) => h.r.scryfallUri)),
    edhrecRank: hits.find((h) => typeof h.r.edhrecRank === "number")?.r.edhrecRank,
    oracleTags: unionArrays(hits.map((h) => h.r.oracleTags)),
    edhrecSynergy: hits.find((h) => typeof h.r.edhrecSynergy === "number")?.r.edhrecSynergy,
    sources: hits.map((h) => h.source.name),
  };

  if (!merged.typeLine) return null; // useless without it
  return merged;
}
