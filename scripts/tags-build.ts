/**
 * Dev-time builder for the precomputed Scryfall oracle-tag map.
 *
 * Walks the curated tag list (seeds/oracle-tags.json), queries Scryfall
 * via `otag:<tag>` search per tag, and writes the result to
 * seeds/oracle-tags-map.json as an inverted index (oracleId → tags).
 *
 * == Incremental updates ==
 *
 * For each tag, we first peek the first page of the search (1 cheap
 * request) and hash the returned oracle_ids. If that hash matches what
 * was stored in the previous map, we know the tag's card set hasn't
 * changed since the last build and we can SKIP the slow multi-page
 * fetch. Tags with a changed digest get re-fetched fully.
 *
 * Trade-off: a tag whose contents reorder but stay the same set would
 * still produce the same hash (we sort the ids before hashing). A tag
 * that gained AND lost cards in equal numbers but stayed the same total
 * count would NOT slip through — we hash the actual id set, not just
 * the count.
 *
 * == Usage ==
 *
 *   pnpm tags:build                  # incremental: re-fetch only changed tags
 *   pnpm tags:build --full           # force a full rebuild of every tag
 *   pnpm tags:build --tags ramp,removal  # only refresh specified tags
 *
 * == Output ==
 *
 *   seeds/oracle-tags-map.json
 *     {
 *       version: 1,
 *       generatedAt: "...ISO timestamp...",
 *       tagDigests: { "<tag>": { count, digest } },
 *       cardTags: { "<oracle-id>": ["tag1", "tag2"] }
 *     }
 *
 * Commit the resulting file so the next deploy ships it.
 *
 * Network-bound — only run from a machine that can reach api.scryfall.com.
 * Inside the container or in a sandboxed CI, use `ingest-tags` which
 * consumes the precomputed file with no network.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sleep, type ScryfallCard } from "../src/lib/scryfall";

interface ScryfallList<T> {
  object: "list";
  total_cards?: number;
  has_more: boolean;
  next_page?: string;
  data: T[];
}

interface TagDigest {
  count: number;
  digest: string;
}

interface OracleTagsMap {
  version: 1;
  generatedAt: string | null;
  tagDigests: Record<string, TagDigest>;
  cardTags: Record<string, string[]>;
}

const TAG_LIST_PATH = resolve(process.cwd(), "seeds/oracle-tags.json");
const TAG_MAP_PATH = resolve(process.cwd(), "seeds/oracle-tags-map.json");
const BASE = "https://api.scryfall.com";

const FULL = process.argv.includes("--full");
const TAGS_FLAG_IDX = process.argv.indexOf("--tags");
const ONLY_TAGS =
  TAGS_FLAG_IDX > -1
    ? new Set(process.argv[TAGS_FLAG_IDX + 1].split(",").map((s) => s.trim()))
    : null;

function headers(): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent":
      process.env.SCRYFALL_USER_AGENT ?? "MTGSynergyMap/0.1 (tags-build)",
  };
}

function digestOf(oracleIds: readonly string[]): string {
  // Stable digest: sort then hash. Order-independent so reshuffling
  // alone doesn't trigger a re-fetch. First 12 chars of sha256 hex is
  // plenty for change detection.
  const h = createHash("sha256");
  h.update([...oracleIds].sort().join(","));
  return h.digest("hex").slice(0, 12);
}

async function fetchWithRetry(url: string): Promise<Response> {
  let res = await fetch(url, { headers: headers() });
  if (res.status !== 429) return res;
  const retryAfter = parseInt(res.headers.get("retry-after") ?? "60", 10);
  const waitMs = Math.min(Math.max(retryAfter, 5), 75) * 1000;
  console.warn(
    `  ! 429 rate-limited; waiting ${Math.round(waitMs / 1000)}s...`,
  );
  await sleep(waitMs);
  return fetch(url, { headers: headers() });
}

async function peekFirstPage(
  tag: string,
): Promise<{ ids: string[]; total: number } | null> {
  const url = `${BASE}/cards/search?q=otag:${encodeURIComponent(tag)}`;
  const res = await fetchWithRetry(url);
  if (res.status === 404) return { ids: [], total: 0 };
  if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as ScryfallList<ScryfallCard>;
  return {
    ids: body.data.map((c) => c.oracle_id ?? c.id),
    total: body.total_cards ?? body.data.length,
  };
}

async function fetchAll(tag: string): Promise<string[]> {
  const out: string[] = [];
  let url: string | undefined = `${BASE}/cards/search?q=otag:${encodeURIComponent(tag)}`;
  let page = 0;
  while (url && page < 20) {
    const res = await fetchWithRetry(url);
    if (res.status === 404) return out;
    if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as ScryfallList<ScryfallCard>;
    out.push(...body.data.map((c) => c.oracle_id ?? c.id));
    url = body.has_more ? body.next_page : undefined;
    page += 1;
    if (url) await sleep(220);
  }
  return out;
}

async function loadExistingMap(): Promise<OracleTagsMap> {
  try {
    const raw = await readFile(TAG_MAP_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OracleTagsMap>;
    return {
      version: 1,
      generatedAt: parsed.generatedAt ?? null,
      tagDigests: parsed.tagDigests ?? {},
      cardTags: parsed.cardTags ?? {},
    };
  } catch {
    return { version: 1, generatedAt: null, tagDigests: {}, cardTags: {} };
  }
}

async function main() {
  const tagList = (
    JSON.parse(await readFile(TAG_LIST_PATH, "utf8")) as { tags: string[] }
  ).tags;
  const tags = ONLY_TAGS
    ? tagList.filter((t) => ONLY_TAGS.has(t))
    : tagList;

  if (ONLY_TAGS && tags.length === 0) {
    console.error("No tags in seeds/oracle-tags.json match --tags filter");
    process.exit(2);
  }

  const previous = await loadExistingMap();
  const out: OracleTagsMap = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tagDigests: { ...previous.tagDigests },
    // Start fresh so removed tags don't linger; we rebuild from scratch
    // and only carry forward what we re-confirm or skip-as-unchanged.
    cardTags: {},
  };

  // Carry forward card→tag entries for tags we don't intend to rebuild,
  // so a `--tags ramp` run doesn't wipe everything else.
  if (ONLY_TAGS) {
    for (const [cardId, cardTags] of Object.entries(previous.cardTags)) {
      const kept = cardTags.filter((t) => !ONLY_TAGS.has(t));
      if (kept.length) out.cardTags[cardId] = kept;
    }
  }

  let refreshed = 0;
  let skipped = 0;
  let totalEntries = 0;

  for (const [i, tag] of tags.entries()) {
    const idx = `[${i + 1}/${tags.length}]`;
    process.stdout.write(`${idx} otag:${tag} ... `);

    if (!FULL) {
      let peek: { ids: string[]; total: number } | null;
      try {
        peek = await peekFirstPage(tag);
      } catch (err) {
        console.warn(`peek failed: ${(err as Error).message}`);
        await sleep(500);
        continue;
      }
      if (!peek) {
        console.warn("no result");
        continue;
      }
      // Cheap path: if the first page's id set fully covers the tag
      // (no pagination) AND its digest matches the previous run, skip
      // the slow full fetch.
      if (
        peek.total === peek.ids.length &&
        previous.tagDigests[tag]?.count === peek.total &&
        previous.tagDigests[tag]?.digest === digestOf(peek.ids)
      ) {
        for (const id of peek.ids) {
          if (!out.cardTags[id]) out.cardTags[id] = [];
          out.cardTags[id].push(tag);
        }
        out.tagDigests[tag] = previous.tagDigests[tag];
        skipped += 1;
        totalEntries += peek.ids.length;
        console.log(`unchanged (${peek.total} cards), skipped`);
        await sleep(220);
        continue;
      }
      // First page matched the previous count but multi-page → fall through
      // to a full fetch so we can hash the complete id set. The next run
      // will be able to use the cached digest as long as it stays stable.
    }

    let ids: string[];
    try {
      ids = await fetchAll(tag);
    } catch (err) {
      console.warn(`fetch failed: ${(err as Error).message}`);
      await sleep(500);
      continue;
    }
    for (const id of ids) {
      if (!out.cardTags[id]) out.cardTags[id] = [];
      out.cardTags[id].push(tag);
    }
    out.tagDigests[tag] = { count: ids.length, digest: digestOf(ids) };
    refreshed += 1;
    totalEntries += ids.length;
    console.log(`${ids.length} cards (fetched)`);
    await sleep(500);
  }

  // De-duplicate per-card tag arrays (paranoia) and sort for stable diffs.
  for (const [id, list] of Object.entries(out.cardTags)) {
    out.cardTags[id] = Array.from(new Set(list)).sort();
  }

  await writeFile(TAG_MAP_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `\nDone. Wrote ${TAG_MAP_PATH}: ${refreshed} tags refreshed, ${skipped} skipped, ${Object.keys(out.cardTags).length} cards tagged, ${totalEntries} total tag-card entries.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
