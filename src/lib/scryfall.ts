// Minimal Scryfall API client.
//
// Scryfall asks consumers to:
//   - send a custom User-Agent identifying the app (see SCRYFALL_USER_AGENT env)
//   - send Accept: application/json
//   - rate-limit themselves to ~10 req/s. We don't run anywhere near that here
//     (single-user dev), but `sleep()` is exposed for batch scripts.
//
// Docs: https://scryfall.com/docs/api

import type { CardSummary } from "./types";
import { extractKeywords } from "./synergy/keywords";

const BASE = "https://api.scryfall.com";

export interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  power?: string;
  toughness?: string;
  keywords?: string[];
  produced_mana?: string[];
  edhrec_rank?: number;
  scryfall_uri?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    png?: string;
    art_crop?: string;
    border_crop?: string;
  };
  // Multi-faced cards put images on card_faces instead of the top level.
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: ScryfallCard["image_uris"];
  }>;
}

interface ScryfallList<T> {
  object: "list";
  total_cards?: number;
  has_more: boolean;
  next_page?: string;
  data: T[];
}

function headers(): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent":
      process.env.SCRYFALL_USER_AGENT ?? "MTGSynergyMap/0.1 (local-dev)",
  };
}

export async function getCardByName(name: string): Promise<ScryfallCard | null> {
  const url = `${BASE}/cards/named?exact=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
  return (await res.json()) as ScryfallCard;
}

// Resolve up to 75 card names per request via Scryfall's collection
// endpoint — vastly faster than per-card `cards/named` lookups and the
// only sane way to resolve a 99-card commander deck without tripping
// the 10 req/s rate limit.
//
// Docs: https://scryfall.com/docs/api/cards/collection
//
// Returns the canonical Scryfall card list plus the verbatim list of
// names the API couldn't match, so the caller can surface them as
// missing cards.
const COLLECTION_CHUNK = 75;

export async function getCardsByNames(
  names: string[],
): Promise<{ found: ScryfallCard[]; notFound: string[] }> {
  const found: ScryfallCard[] = [];
  const notFound: string[] = [];
  for (let i = 0; i < names.length; i += COLLECTION_CHUNK) {
    const chunk = names.slice(i, i + COLLECTION_CHUNK);
    const res = await fetch(`${BASE}/cards/collection`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        identifiers: chunk.map((name) => ({ name })),
      }),
    });
    if (res.status === 429) {
      throw new Error(
        "Scryfall rate-limited the request. Wait ~60s and try again — or run `pnpm ingest` once to populate the local DB so future pastes don't hit the network.",
      );
    }
    if (!res.ok) {
      throw new Error(`Scryfall collection ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      data: ScryfallCard[];
      not_found?: Array<{ name?: string }>;
    };
    found.push(...body.data);
    notFound.push(
      ...(body.not_found ?? []).map((x, idx) => x.name ?? chunk[idx] ?? ""),
    );
    // Polite gap between chunks. A single 99-card deck = 2 chunks → one
    // ~110ms pause, imperceptible to the user but keeps us well under
    // the 10 req/s ceiling even with concurrent users.
    if (i + COLLECTION_CHUNK < names.length) await sleep(110);
  }
  return { found, notFound };
}

export async function searchCards(query: string, maxPages = 1): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = [];
  let url: string | undefined = `${BASE}/cards/search?q=${encodeURIComponent(query)}`;
  let page = 0;
  while (url && page < maxPages) {
    const res: Response = await fetch(url, { headers: headers() });
    if (res.status === 404) return out;
    if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as ScryfallList<ScryfallCard>;
    out.push(...body.data);
    url = body.has_more ? body.next_page : undefined;
    page += 1;
    if (url) await sleep(120); // be polite between pages
  }
  return out;
}

export function toCardSummary(c: ScryfallCard): CardSummary {
  const images = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  return {
    id: c.oracle_id ?? c.id,
    name: c.name,
    typeLine: c.type_line,
    manaCost: c.mana_cost ?? null,
    colors: c.colors ?? [],
    imageSmall: images?.small ?? null,
    imageNormal: images?.normal ?? null,
    scryfallUri: c.scryfall_uri ?? null,
    keywords: extractKeywords({
      keywords: c.keywords ?? [],
      type_line: c.type_line,
      oracle_text: c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).join("\n") ?? "",
      produced_mana: c.produced_mana ?? [],
    }),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
