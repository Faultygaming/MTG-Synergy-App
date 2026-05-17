// Scryfall source adapter. Wraps the existing client in lib/scryfall.ts
// behind the CardSource interface.

import { getCardByName } from "../scryfall";
import type { CardSource, SourceCard } from "./types";

export const scryfallSource: CardSource = {
  name: "scryfall",
  priority: 10,
  async fetchByName(name: string): Promise<SourceCard | null> {
    const c = await getCardByName(name);
    if (!c) return null;
    const images = c.image_uris ?? c.card_faces?.[0]?.image_uris;
    return {
      source: "scryfall",
      id: c.oracle_id ?? c.id,
      name: c.name,
      typeLine: c.type_line,
      oracleText:
        c.oracle_text ??
        c.card_faces?.map((f) => f.oracle_text ?? "").filter(Boolean).join("\n"),
      manaCost: c.mana_cost,
      cmc: c.cmc,
      colors: c.colors,
      colorIdentity: c.color_identity,
      printedKeywords: c.keywords,
      imageSmall: images?.small,
      imageNormal: images?.normal,
      scryfallUri: c.scryfall_uri,
      edhrecRank: c.edhrec_rank,
    };
  },
};
