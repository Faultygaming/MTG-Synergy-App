// Commander format rule enforcement.
//
// Source of truth: https://magic.wizards.com/en/formats/commander
// (and the RC banned-list page linked from there).
//
// What we validate at deck-construction time:
//   1. Deck size = 100 (commander + 99).
//   2. Singleton: exactly 1 copy of any non-basic, except cards whose oracle
//      text grants "A deck can have any number of cards named ___" (e.g.
//      Persistent Petitioners, Relentless Rats, Shadowborn Apostle, Rat Colony,
//      Dragon's Approach, Seven Dwarves, Templar Knight).
//   3. Commander legality: must be a legendary creature, or a planeswalker
//      whose oracle text says it can be your commander.
//      Partner / Background / Friends Forever / Choose-a-Background pairings
//      are allowed — represented here as an optional second commander.
//   4. Color identity: every card's color identity must be a subset of the
//      commander(s)' combined color identity.
//   5. Banned list: hard reject. The list below is a snapshot — refresh from
//      the canonical URL during ingest. See data/commander-banned.json.
//
// What we DON'T enforce here (out of scope or out of band):
//   - Companion rules (the companion sits outside the 100 and has its own
//     deck-construction requirement; we'll model this when we add Companion
//     support).
//   - Set legality / silver-bordered / Un-set cards.
//   - Bracket / power-level rules (those are social, not format-legal).

import type { CardSummary } from "../types";

export interface CommanderLegalityCard extends CardSummary {
  colorIdentity?: string[];        // e.g. ["G","W"] — Scryfall's color_identity.
  oracleText?: string | null;
  // typeLine on CardSummary is already canonical.
}

export interface CommanderDeckInput {
  // The pasted/loaded 99 (or 98 with partners). Quantity per entry.
  cards: Array<{ card: CommanderLegalityCard; quantity: number }>;
  // One or two commanders. The second slot is for Partner/Background pairings.
  commanders: CommanderLegalityCard[];
}

export type Violation =
  | { kind: "deck-size"; expected: 100; actual: number }
  | { kind: "no-commander" }
  | { kind: "too-many-commanders"; count: number }
  | {
      kind: "illegal-commander";
      cardName: string;
      reason: "not-legendary" | "not-creature-or-eligible-pw";
    }
  | {
      kind: "partners-not-allowed";
      cardName: string;
    }
  | {
      kind: "color-identity";
      cardName: string;
      cardCi: string[];
      commanderCi: string[];
    }
  | { kind: "singleton"; cardName: string; quantity: number }
  | { kind: "banned"; cardName: string };

// Snapshot of the Commander banned list (the Commander Format Panel list,
// mirrored by WotC at https://magic.wizards.com/en/banned-restricted-list).
// Canonical source: https://mtgcommander.net/index.php/banned-list/
//
// Last refreshed against the Feb 9, 2026 announcement:
//   - Biorhythm: unbanned
//   - Lutri, the Spellchaser: legal as a commander; remains banned as a
//     companion (companion handling is out-of-scope here — see comments
//     above; we do NOT include Lutri in this set).
//
// Refresh procedure (manual until we add scripts/ingest-banlist.ts):
//   1. Fetch the canonical mtgcommander.net banlist.
//   2. Diff against this set; add/remove names verbatim (must match Scryfall
//      canonical English name).
export const COMMANDER_BANNED: ReadonlySet<string> = new Set([
  "Ancestral Recall",
  "Balance",
  "Black Lotus",
  "Braids, Cabal Minion",
  "Chaos Orb",
  "Coalition Victory",
  "Channel",
  "Dockside Extortionist",
  "Emrakul, the Aeons Torn",
  "Erayo, Soratami Ascendant",
  "Falling Star",
  "Fastbond",
  "Flash",
  "Gifts Ungiven",
  "Golos, Tireless Pilgrim",
  "Griselbrand",
  "Hullbreacher",
  "Iona, Shield of Emeria",
  "Jeweled Lotus",
  "Karakas",
  "Leovold, Emissary of Trest",
  "Library of Alexandria",
  "Limited Resources",
  "Mana Crypt",
  "Mox Emerald",
  "Mox Jet",
  "Mox Pearl",
  "Mox Ruby",
  "Mox Sapphire",
  "Nadu, Winged Wisdom",
  "Panoptic Mirror",
  "Paradox Engine",
  "Primeval Titan",
  "Prophet of Kruphix",
  "Recurring Nightmare",
  "Rofellos, Llanowar Emissary",
  "Shahrazad",
  "Sundering Titan",
  "Sway of the Stars",
  "Sylvan Primordial",
  "Time Vault",
  "Time Walk",
  "Tinker",
  "Tolarian Academy",
  "Trade Secrets",
  "Upheaval",
  "Worldfire",
  "Yawgmoth's Bargain",
]);

// Basic land names + the snow basics. Singleton rule excludes these.
export const BASIC_LANDS: ReadonlySet<string> = new Set([
  "Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
  "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
  "Snow-Covered Mountain", "Snow-Covered Forest", "Snow-Covered Wastes",
]);

// "A deck can have any number of cards named ___". Match by exact name.
// (List drawn from the canonical "any number" oracle text; extend as new
// cards print.)
export const UNLIMITED_COPIES_ALLOWED: ReadonlySet<string> = new Set([
  "Relentless Rats",
  "Shadowborn Apostle",
  "Rat Colony",
  "Persistent Petitioners",
  "Dragon's Approach",
  "Seven Dwarves",
  "Templar Knight",
  "Hare Apparent",
  "Nazgûl",
  "Slime Against Humanity",
]);

export function colorIdentityUnion(commanders: CommanderLegalityCard[]): string[] {
  const set = new Set<string>();
  for (const c of commanders) for (const x of c.colorIdentity ?? []) set.add(x);
  return Array.from(set).sort();
}

function isSubset(child: string[] = [], parent: string[]): boolean {
  const p = new Set(parent);
  for (const c of child) if (!p.has(c)) return false;
  return true;
}

// Type lines whose printed Legendary forms are eligible to be a commander
// without additional rules text. As of the 2024–2025 rules updates this
// covers Creatures, Vehicles, and Spacecraft (Edge of Eternities). Any other
// card type can still be a commander if its oracle text explicitly says so
// ("<name> can be your commander."), which is caught separately.
const COMMANDER_ELIGIBLE_TYPES = ["creature", "vehicle", "spacecraft"] as const;

function hasCommanderEligibleType(card: CommanderLegalityCard): boolean {
  const tl = (card.typeLine ?? "").toLowerCase();
  return COMMANDER_ELIGIBLE_TYPES.some((t) => tl.includes(t));
}

function hasCanBeYourCommanderText(card: CommanderLegalityCard): boolean {
  return /can be your commander\b/i.test(card.oracleText ?? "");
}

function isCommanderLegal(
  card: CommanderLegalityCard,
): true | "not-legendary" | "not-creature-or-eligible-pw" {
  const tl = (card.typeLine ?? "").toLowerCase();
  if (!tl.includes("legendary")) return "not-legendary";
  if (hasCommanderEligibleType(card)) return true;
  if (hasCanBeYourCommanderText(card)) return true;
  return "not-creature-or-eligible-pw";
}

function hasPartner(card: CommanderLegalityCard): boolean {
  const t = card.oracleText ?? "";
  // Covers "Partner", "Partner with X", "Friends forever", and "Choose a
  // Background" (which lets a Background pair with this commander).
  return /\bpartner\b|friends forever|choose a background/i.test(t);
}

function isBackground(card: CommanderLegalityCard): boolean {
  return /\bbackground\b/i.test((card.typeLine ?? "").toLowerCase());
}

export function validateCommanderDeck(input: CommanderDeckInput): Violation[] {
  const violations: Violation[] = [];
  const { commanders, cards } = input;

  // --- Commander slot ---
  if (commanders.length === 0) {
    violations.push({ kind: "no-commander" });
  } else if (commanders.length > 2) {
    violations.push({ kind: "too-many-commanders", count: commanders.length });
  } else {
    for (const cmd of commanders) {
      const r = isCommanderLegal(cmd);
      if (r !== true) {
        violations.push({ kind: "illegal-commander", cardName: cmd.name, reason: r });
      }
    }
    if (commanders.length === 2) {
      // Both must have partner-style text, OR exactly one is a Background.
      const oneIsBackground = commanders.some(isBackground);
      const bothPartner = commanders.every(hasPartner);
      const backgroundPairValid =
        oneIsBackground &&
        commanders.some((c) => /choose a background/i.test(c.oracleText ?? ""));
      if (!bothPartner && !backgroundPairValid) {
        for (const c of commanders) {
          if (!hasPartner(c) && !isBackground(c)) {
            violations.push({ kind: "partners-not-allowed", cardName: c.name });
          }
        }
      }
    }
  }

  // --- Deck size ---
  const total = cards.reduce((s, e) => s + e.quantity, 0) + commanders.length;
  if (total !== 100) {
    violations.push({ kind: "deck-size", expected: 100, actual: total });
  }

  // --- Singleton + banned + color identity ---
  const ci = colorIdentityUnion(commanders);
  for (const e of cards) {
    if (COMMANDER_BANNED.has(e.card.name)) {
      violations.push({ kind: "banned", cardName: e.card.name });
    }
    if (
      e.quantity > 1 &&
      !BASIC_LANDS.has(e.card.name) &&
      !UNLIMITED_COPIES_ALLOWED.has(e.card.name)
    ) {
      violations.push({
        kind: "singleton",
        cardName: e.card.name,
        quantity: e.quantity,
      });
    }
    if (commanders.length > 0 && !isSubset(e.card.colorIdentity ?? [], ci)) {
      violations.push({
        kind: "color-identity",
        cardName: e.card.name,
        cardCi: e.card.colorIdentity ?? [],
        commanderCi: ci,
      });
    }
  }

  return violations;
}

// Quick predicate used by /api/cards/suggest to filter the candidate pool
// before scoring. Returns true if a candidate card is legal to ADD to a
// commander deck (color-identity compliant + not banned + not already at
// max copies). Caller is responsible for "already in deck" exclusion.
export function isCandidateLegal(
  candidate: CommanderLegalityCard,
  commanders: CommanderLegalityCard[],
): boolean {
  if (COMMANDER_BANNED.has(candidate.name)) return false;
  if (commanders.length === 0) return true; // no commander → no CI to check yet
  const ci = colorIdentityUnion(commanders);
  return isSubset(candidate.colorIdentity ?? [], ci);
}

export function formatViolation(v: Violation): string {
  switch (v.kind) {
    case "deck-size":
      return `Deck must be exactly 100 cards (has ${v.actual}).`;
    case "no-commander":
      return "Deck is missing a commander.";
    case "too-many-commanders":
      return `Too many commanders (${v.count}). Maximum is 2 with Partner/Background.`;
    case "illegal-commander":
      return `${v.cardName} can't be a commander: ${
        v.reason === "not-legendary" ? "not legendary" : "not a creature or eligible planeswalker"
      }.`;
    case "partners-not-allowed":
      return `${v.cardName} doesn't have Partner or Background — can't be paired.`;
    case "color-identity":
      return `${v.cardName} (${v.cardCi.join("") || "C"}) is outside the commander's color identity (${v.commanderCi.join("") || "C"}).`;
    case "singleton":
      return `${v.cardName} appears ${v.quantity}× — Commander is singleton (basics and "any number of" cards excepted).`;
    case "banned":
      return `${v.cardName} is on the Commander banned list.`;
  }
}
