// Moxfield public-deck importer.
//
// Moxfield URLs look like https://moxfield.com/decks/<public-id>. Their v3
// public API exposes the deck contents without auth as long as the deck
// is marked public:
//
//   https://api2.moxfield.com/v3/decks/all/<public-id>
//
// We extract a flat "name + quantity" list compatible with our decklist
// parser, plus the commander(s) so the commander rules module can validate.

export interface MoxfieldImported {
  name: string;
  format: string;
  commanders: string[];                  // card names
  cards: Array<{ name: string; quantity: number }>;
  sideboard: Array<{ name: string; quantity: number }>;
}

export function extractDeckId(url: string): string | null {
  // Accepts:
  //   https://moxfield.com/decks/<id>
  //   https://www.moxfield.com/decks/<id>
  //   moxfield.com/decks/<id>
  //   bare <id>
  try {
    const trimmed = url.trim();
    if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed)) return trimmed;
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (!/(^|\.)moxfield\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/decks\/([A-Za-z0-9_-]+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

interface MoxfieldV3Card {
  card: { name: string };
  quantity: number;
}

interface MoxfieldV3Board {
  cards: Record<string, MoxfieldV3Card>;
}

interface MoxfieldV3Deck {
  name: string;
  format: string;
  boards: {
    mainboard: MoxfieldV3Board;
    sideboard?: MoxfieldV3Board;
    commanders?: MoxfieldV3Board;
    companions?: MoxfieldV3Board;
  };
}

function flatten(board?: MoxfieldV3Board): Array<{ name: string; quantity: number }> {
  if (!board) return [];
  return Object.values(board.cards).map((c) => ({
    name: c.card.name,
    quantity: c.quantity,
  }));
}

export async function importMoxfieldDeck(idOrUrl: string): Promise<MoxfieldImported> {
  const id = extractDeckId(idOrUrl);
  if (!id) throw new Error("Not a valid Moxfield URL or deck id.");
  const res = await fetch(`https://api2.moxfield.com/v3/decks/all/${id}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Moxfield ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const body = (await res.json()) as MoxfieldV3Deck;
  return {
    name: body.name,
    format: body.format,
    commanders: flatten(body.boards.commanders).map((c) => c.name),
    cards: flatten(body.boards.mainboard),
    sideboard: flatten(body.boards.sideboard),
  };
}

// Convenience: convert a Moxfield import into a plain decklist string that
// our parseDecklist() understands. Commanders are kept separate.
export function toPlainDecklist(imp: MoxfieldImported): string {
  return imp.cards.map((c) => `${c.quantity} ${c.name}`).join("\n");
}
