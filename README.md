# MTG Synergy Map

A word-map style synergy explorer and deck builder for Magic: The Gathering.
Paste a decklist, see it rendered as a bipartite graph of cards and shared
keywords, and get a ranked sidebar of suggested cards bordered in
**gold / silver / bronze** to match your deck's primary, secondary and
tertiary synergy patterns.

The product takes cues from
[scryndr.com](https://scryndr.com/),
[mtgsynergy.app](https://www.mtgsynergy.app/), and
[neocalculators MTG Synergy Calculator](https://neocalculators.com/mtg-synergy-calculator/),
but is built around the graph view as the primary surface rather than a
text summary or self-scored rubric.

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind**
- **SQLite + Prisma** for local persistence (DB file lives in `./data/`)
- **Cytoscape.js** via `react-cytoscapejs` for the synergy map
- **Vitest** for unit tests
- **Scryfall API** for card data; bulk ingest supported but optional

## Package manager policy: pnpm only

**This project does not use npm.** Lifecycle scripts run a preinstall guard
([`scripts/check-package-manager.mjs`](scripts/check-package-manager.mjs))
that refuses any package manager other than pnpm. Use [Corepack](https://nodejs.org/api/corepack.html)
(bundled with Node 20+) to get the pinned pnpm version:

```bash
corepack enable
corepack prepare pnpm@9.12.3 --activate
```

Then:

```bash
pnpm install
```

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm db:push           # apply Prisma schema to ./data/synergy.db
pnpm seed              # load ~20 hand-curated demo cards
pnpm dev               # http://localhost:3000
```

Paste a decklist on `/deck/new` (the form is pre-populated with a Mono-Green
Elves sample). Submit → you'll land on `/deck/[id]` with the synergy map and
ranked sidebar.

### Optional: full Scryfall corpus

```bash
pnpm ingest            # downloads oracle_cards bulk (~120 MB) and loads it
pnpm ingest --force    # refresh even if a cached download exists
```

## Synergy model

Each card's keywords come from three rules-based sources combined:

1. **Scryfall's printed `keywords[]`** — flying, ward, cycling, etc.
2. **Type-line tokens** — supertypes (`creature`), card types (`instant`),
   and subtypes/tribes (`elf`, `human`, `wizard`) from after the em-dash.
3. **A small regex pack over `oracle_text`** — high-signal templates
   Scryfall doesn't surface (etb-trigger, ramp, token-maker, removal-targeted,
   draw, etc.). See [`src/lib/synergy/keywords.ts`](src/lib/synergy/keywords.ts).

NLP/ML keyword extraction is deliberately deferred to v2; the [research
notes](#) suggest Scryfall's oracle tags (the `otag:` taxonomy) are the
highest-value next addition.

**Tier algorithm** (see [`src/lib/synergy/score.ts`](src/lib/synergy/score.ts)):

- Compute keyword frequency across the deck. Top three keywords are the
  deck's **primary / secondary / tertiary** patterns.
- For each candidate card, the **tier** is the highest of those three patterns
  it matches: gold > silver > bronze.
- Sidebar rank: tier first, then shared-keyword count within tier.
  **A gold-3 outranks a silver-5** — tier dominates raw count.

## Layout

```
prisma/schema.prisma        Card, Deck, DeckCard tables (SQLite)
src/lib/
  ├── db.ts                 Prisma singleton
  ├── scryfall.ts           Scryfall API client + ScryfallCard → CardSummary
  ├── decklist.ts           Plain-text decklist parser
  ├── types.ts              CardSummary, DeckEntry, SynergySuggestion, Tier
  └── synergy/
      ├── keywords.ts       Rules-based keyword extraction
      ├── score.ts          Frequency, scoreCandidate, rankSuggestions
      └── tiers.ts          UI bindings for tier visuals
src/app/
  ├── page.tsx              Landing
  ├── deck/new/page.tsx     Paste form
  ├── deck/[id]/page.tsx    Map + sidebar
  └── api/decks/route.ts    POST: parse list, resolve via Scryfall, persist
src/components/
  ├── SynergyMap.tsx        Cytoscape bipartite graph
  ├── DeckSidebar.tsx       Ranked suggestions
  ├── CardChip.tsx          Card row with tier border + share-count badge
  └── DeckPasteForm.tsx     Client form posting to /api/decks
scripts/
  ├── check-package-manager.mjs   Preinstall guard, refuses non-pnpm
  ├── seed-fixtures.ts            pnpm seed
  └── ingest-scryfall.ts          pnpm ingest [--force]
data/
  ├── fixtures.json         Demo cards used by `pnpm seed`
  ├── synergy.db            SQLite DB (gitignored)
  └── scryfall-bulk/        Cached oracle_cards.json (gitignored)
```

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Run the production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `next lint` |
| `pnpm test` | Run vitest suite once |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm db:push` | Apply schema to SQLite |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm seed` | Load demo fixture cards |
| `pnpm ingest [--force]` | Bulk-ingest the Scryfall `oracle_cards` corpus |

## Commander format enforcement

Commander is the v1 first-class format and rules are enforced at deck
construction time by [`src/lib/commander/rules.ts`](src/lib/commander/rules.ts):

- 100-card deck size (commander + 99).
- Singleton rule with the standard basic-land and "any number of" exceptions.
- Color identity must be a subset of the commander's combined CI.
- Commander eligibility: legendary creature, legendary vehicle/spacecraft,
  or any card with "<name> can be your commander." text. Partner /
  Background / Friends Forever pairings supported.
- Banned-list check against a snapshot (last refreshed Feb 9, 2026 —
  see the `COMMANDER_BANNED` comment in `rules.ts` for refresh procedure).

Violations are persisted on the deck and shown as a red banner on the deck
page. Suggestion ranking automatically filters out cards that would be
illegal (out of color identity or banned).

## Moxfield import

The API supports a `kind: "moxfield"` POST body with a deck URL:

```ts
fetch("/api/decks", {
  method: "POST",
  body: JSON.stringify({ kind: "moxfield", url: "https://moxfield.com/decks/..." }),
});
```

This calls Moxfield's public v3 deck API. Note: in **sandboxed environments
that restrict outbound HTTP** (including Claude Code remote execution),
Moxfield's API host may be blocked; locally it works fine.

## Roadmap

- [ ] Scryfall oracle tags (`otag:`) as a first-class keyword source
- [ ] EDHREC "lift" co-occurrence enrichment (with caching + attribution)
- [ ] Deck import from Moxfield / Archidekt / MTGGoldfish URLs
- [ ] Format-aware candidate filtering (commander color identity, banlists)
- [ ] Compound nodes in Cytoscape to cluster keywords into strategy groups
      (ramp / removal / value / combo) matching the six-axis framing from
      neocalculators
- [ ] v2 keyword extraction: light NLP over oracle text for ETB clustering
      and infinite-combo detection
