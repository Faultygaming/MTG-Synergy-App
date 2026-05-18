/**
 * Audit keyword extraction coverage against the local Card corpus.
 *
 *   pnpm tsx scripts/analyze-keywords.ts
 *
 * Walks every Card row, recomputes its keyword set with the CURRENT
 * extractKeywords logic, and reports:
 *
 *   1. Distribution of keyword counts per card (how many cards have
 *      0 / 1-2 / 3-5 / 6+ keywords beyond stoplist).
 *   2. Cards with ≤1 surviving (non-stoplist) keyword — these are the
 *      "under-tagged" cards we're missing archetype keywords for. The
 *      analyzer dumps a sample of their oracle text so we can spot
 *      patterns to add to the regex pack.
 *   3. Frequency of every extracted keyword across the corpus —
 *      identifies the keywords that NEVER fire (regex bugs) and the
 *      keywords that fire on every card (potential stoplist additions).
 *   4. Common bigrams / trigrams in under-tagged cards' oracle text —
 *      candidate phrases to turn into new regex patterns.
 *
 * Output written to data/keyword-audit.txt for easy inspection.
 *
 * Run after `ingest` (or `--force`) so the corpus is fresh. Pure
 * read-only — does not modify any Card rows.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import { extractKeywords } from "../src/lib/synergy/keywords";
import { COMMON_KEYWORD_STOPLIST } from "../src/lib/synergy/stoplist";

const SAMPLE_UNDERTAGGED = 40;
const TOP_NGRAMS = 60;
const NGRAM_MIN_FREQ = 8;

interface AnalyzeResult {
  total: number;
  buckets: Record<string, number>;
  perKeyword: Map<string, number>;
  undertagged: Array<{ name: string; typeLine: string; oracleText: string; extracted: string[] }>;
  bigrams: Array<{ phrase: string; count: number }>;
  trigrams: Array<{ phrase: string; count: number }>;
}

function tokenize(s: string): string[] {
  // Strip reminder text (parenthesized) + mana symbols + standalone numbers,
  // collapse whitespace, lowercase. Keep apostrophes inside words (don't,
  // it's, can't) so phrases like "you may" stay coherent.
  return s
    .replace(/\([^)]*\)/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/[^a-z'\s]/gi, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "for", "from", "with", "and", "or", "as",
  "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "they", "them", "their",
  "you", "your", "yours", "i", "we", "us", "our", "ours",
  "if", "then", "else", "when", "while", "until", "before", "after",
  "in", "on", "at", "by", "into", "onto", "off", "out", "up", "down",
  "may", "can", "could", "would", "should", "must", "will", "shall",
  "do", "does", "did", "have", "has", "had",
  "card", "cards", "any", "each", "every", "all", "no", "not",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "target", "this", "that", "name", "named",
]);

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    const slice = tokens.slice(i, i + n);
    // Drop n-grams where every word is a stopword.
    if (slice.every((t) => STOPWORDS.has(t))) continue;
    // Also drop n-grams that are mostly stopwords (≥ floor(n/2)+1 of them).
    const sw = slice.filter((t) => STOPWORDS.has(t)).length;
    if (sw > n / 2) continue;
    out.push(slice.join(" "));
  }
  return out;
}

async function main(): Promise<void> {
  const cards = await prisma.card.findMany({
    select: {
      name: true,
      typeLine: true,
      oracleText: true,
      keywordsJson: true,
      oracleTagsJson: true,
    },
  });

  console.log(`Analyzing ${cards.length} cards...`);
  const result: AnalyzeResult = {
    total: cards.length,
    buckets: { "0": 0, "1-2": 0, "3-5": 0, "6+": 0 },
    perKeyword: new Map(),
    undertagged: [],
    bigrams: [],
    trigrams: [],
  };
  const bigramCounts = new Map<string, number>();
  const trigramCounts = new Map<string, number>();

  for (const c of cards) {
    const oracleTags = JSON.parse(c.oracleTagsJson) as string[];
    const extracted = extractKeywords(
      {
        keywords: [],
        type_line: c.typeLine,
        oracle_text: c.oracleText ?? "",
        produced_mana: [],
      },
      oracleTags,
    );
    const surviving = extracted.filter((k) => !COMMON_KEYWORD_STOPLIST.has(k));
    for (const k of surviving) {
      result.perKeyword.set(k, (result.perKeyword.get(k) ?? 0) + 1);
    }
    if (surviving.length === 0) result.buckets["0"] += 1;
    else if (surviving.length <= 2) result.buckets["1-2"] += 1;
    else if (surviving.length <= 5) result.buckets["3-5"] += 1;
    else result.buckets["6+"] += 1;

    if (surviving.length <= 1 && c.oracleText) {
      if (result.undertagged.length < SAMPLE_UNDERTAGGED) {
        result.undertagged.push({
          name: c.name,
          typeLine: c.typeLine,
          oracleText: c.oracleText,
          extracted: surviving,
        });
      }
      // Mine bigrams + trigrams from under-tagged cards: these are the
      // phrases we're "missing" coverage on.
      const toks = tokenize(c.oracleText);
      for (const bg of ngrams(toks, 2)) {
        bigramCounts.set(bg, (bigramCounts.get(bg) ?? 0) + 1);
      }
      for (const tg of ngrams(toks, 3)) {
        trigramCounts.set(tg, (trigramCounts.get(tg) ?? 0) + 1);
      }
    }
  }

  result.bigrams = Array.from(bigramCounts.entries())
    .filter(([, n]) => n >= NGRAM_MIN_FREQ)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_NGRAMS);
  result.trigrams = Array.from(trigramCounts.entries())
    .filter(([, n]) => n >= NGRAM_MIN_FREQ)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_NGRAMS);

  let out = `Keyword-extraction audit
========================
Corpus size: ${result.total} cards

Distribution (cards by # of non-stoplist keywords):
  0     (no archetype tags at all): ${result.buckets["0"]}  (${pct(result.buckets["0"], result.total)})
  1-2:                              ${result.buckets["1-2"]}  (${pct(result.buckets["1-2"], result.total)})
  3-5:                              ${result.buckets["3-5"]}  (${pct(result.buckets["3-5"], result.total)})
  6+:                               ${result.buckets["6+"]}  (${pct(result.buckets["6+"], result.total)})

Keywords ranked by corpus frequency (top 80):
${[...result.perKeyword.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 80)
  .map(([k, n]) => `  ${n.toString().padStart(6)}  ${k}`)
  .join("\n")}

Keywords that fire on ≤ 3 cards (regex bugs or vanishingly rare archetypes):
${[...result.perKeyword.entries()]
  .filter(([, n]) => n <= 3)
  .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
  .map(([k, n]) => `  ${n}  ${k}`)
  .join("\n") || "  (none — all keywords fire on > 3 cards)"}

Sample of under-tagged cards (≤ 1 archetype keyword) — these need new regex patterns:
${result.undertagged
  .map(
    (c, i) =>
      `[${i + 1}] ${c.name}  (${c.typeLine})  [${c.extracted.join(", ") || "—"}]\n    ${c.oracleText.replace(/\n/g, " ")}`,
  )
  .join("\n\n")}

Common bigrams from under-tagged oracle text (≥ ${NGRAM_MIN_FREQ} occurrences):
${result.bigrams.map((b) => `  ${b.count.toString().padStart(6)}  ${b.phrase}`).join("\n")}

Common trigrams from under-tagged oracle text:
${result.trigrams.map((t) => `  ${t.count.toString().padStart(6)}  ${t.phrase}`).join("\n")}
`;

  const path = resolve(process.cwd(), "data/keyword-audit.txt");
  writeFileSync(path, out, "utf8");
  console.log(`\nWrote ${path}`);
  console.log(
    `Coverage summary: ${result.buckets["0"]}/${result.total} (${pct(result.buckets["0"], result.total)}) cards have ZERO archetype keywords.`,
  );
}

function pct(n: number, d: number): string {
  if (d === 0) return "0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
