# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

**MTG Synergy Map** — a deck-building tool for Magic: The Gathering where the
core surface is a bipartite "word map" of cards and shared keywords, plus a
sidebar of ranked card suggestions with **gold / silver / bronze** borders
representing match against the deck's primary, secondary and tertiary
synergy patterns. The product framing borrows from scryndr.com, mtgsynergy.app
and neocalculators' synergy calculator; the graph view is the wedge.

## Package manager policy — **pnpm only**

This project deliberately avoids npm. `package.json` pins pnpm via
`packageManager` and the `preinstall` script
(`scripts/check-package-manager.mjs`) hard-rejects any other package
manager — running `npm install` or `yarn` will exit non-zero with an
explanatory message. When suggesting commands to the user, **always use
`pnpm`** (never `npm` or `npx`). To bootstrap pnpm:

```bash
corepack enable && corepack prepare pnpm@9.12.3 --activate
```

## Commands

```bash
pnpm install            # respects the preinstall guard
pnpm dev                # Next.js on :3000
pnpm build              # production build
pnpm typecheck          # tsc --noEmit
pnpm lint               # next lint
pnpm test               # vitest run
pnpm test path/to/file  # single test file
pnpm test -t "tier"     # filter by test name substring
pnpm db:push            # apply prisma/schema.prisma to ./data/synergy.db
pnpm db:studio          # open Prisma Studio
pnpm seed               # load data/fixtures.json (~20 demo cards)
pnpm ingest [--force]   # bulk-ingest Scryfall oracle_cards (~120MB download)
```

First-time setup: `pnpm install && cp .env.example .env && pnpm db:push && pnpm seed && pnpm dev`.

## Architecture

### Data flow at a glance

```
Pasted decklist ─► /api/decks (parses, resolves via Scryfall, persists)
                       │
                       ▼
                 SQLite (Card / Deck / DeckCard)
                       │
                       ▼
       /deck/[id] page (server component) loads the deck + a candidate pool
                       │
                       ▼
       lib/synergy/score.rankCandidates → ranked SynergySuggestion[]
                       │
                       ▼
       <SynergyMap> (Cytoscape bipartite graph) + <DeckSidebar> (tier list)
```

### Commander format is enforced

This app treats **Commander** as the first-class (and currently only) format.
`src/lib/commander/rules.ts` is the rule engine; it must stay aligned with
the canonical Commander Format Panel rules at
https://mtgcommander.net/index.php/rules/ (WotC mirror:
https://magic.wizards.com/en/formats/commander).

What it enforces:

- **Deck size = exactly 100** (commander + 99).
- **Singleton**, with the basic-land exception and the canonical
  "A deck can have any number of cards named ___" list
  (Relentless Rats, Shadowborn Apostle, Persistent Petitioners, Rat Colony,
  Dragon's Approach, Seven Dwarves, Templar Knight, Slime Against Humanity,
  Hare Apparent, Nazgûl).
- **Color identity**: every card's CI must be a subset of the combined
  commander CI. (Card CI = colors of mana symbols anywhere in the card's
  cost, rules text, and color indicators, on both faces.)
- **Commander eligibility**: legendary creature; OR legendary vehicle / legendary
  spacecraft (per the 2024–2025 rules expansion that brought *Hearthhull, the
  Worldseed* and friends in as commanders); OR any card with the explicit text
  "<name> can be your commander." (covers the planeswalker commanders).
  Partner / Background / Friends Forever pairings allow a second commander.
- **Banned list**: hardcoded in `COMMANDER_BANNED` in `rules.ts`, last
  refreshed against the **Feb 9, 2026** announcement (Biorhythm unbanned;
  Lutri legal as commander but still banned as companion — companion
  semantics aren't modeled yet).

What we don't enforce yet (out of scope or out of band):
- Companion deck-construction.
- Bracket / power-level (those are social, not format-legal).
- Set / silver-bordered legality.

**Wiring**: `validateCommanderDeck()` runs in `POST /api/decks` after
Scryfall resolution; the resulting violations are persisted on the Deck row
(`violationsJson`) and rendered as a red banner on the deck page.
`isCandidateLegal()` filters the candidate pool used by the sidebar so we
never suggest a card outside the commander's color identity or on the
banlist.

When extending these rules, **also update**: the test file
`src/lib/commander/rules.test.ts`, this section of CLAUDE.md, and the
"banlist last refreshed" comment in `rules.ts`.

#### Per-rule severity toggles (off / warn / block)

Every rule can be set independently to **`off` / `warn` / `block`** via
`CommanderRulesConfig` (`src/lib/commander/config.ts`). Defaults are all
`block`. Persistence: `Deck.rulesConfigJson` per deck.

- `block`: emits a violation with `severity: "block"`. UI shows it as an
  error; `hasBlockingViolations()` returns true; `isCandidateLegal()`
  filters cards that would trip this rule.
- `warn`: emits a violation with `severity: "warn"`. UI shows it in a
  softer banner; candidate-pool filtering is NOT applied.
- `off`: the check is skipped entirely; no violations of this kind emit.

There's also a `globalMode` knob (`"strict" | "warn"`) that downgrades
every `block` to `warn` in one switch — used by the per-deck "permissive"
mode in the UI. Rules set to `off` stay off regardless.

The deck page exposes the toggle UI via `<RulesConfigPanel>` (`src/components/RulesConfigPanel.tsx`).
It PATCHes `/api/decks/[id]/rules`, which re-runs validation and persists
the new config + fresh violations.

### Multi-source card data (`src/lib/sources/`)

`src/lib/sources/types.ts` defines `CardSource` and `MergedCard`. The
`resolveCard(name)` aggregator in `aggregator.ts` calls every registered
source in priority order (lower = higher priority) and merges results:

- **Core fields** (typeLine, oracleText, mana cost, images, etc.):
  first-non-empty wins, respecting priority.
- **Arrays** (`printedKeywords`, `oracleTags`): unioned across sources.
- **Source-specific extras** (`edhrecRank`, `edhrecSynergy`): first-set wins.

Current sources:

| Source   | Priority | Status | Purpose |
|----------|----------|--------|---------|
| scryfall | 10       | live   | Canonical card data, images, printed keywords |
| mtgjson  | 20       | stub   | EDHREC rank, ruling provenance, alt-name lookup |
| edhrec   | 30       | stub   | Lift / co-occurrence stats for synergy scoring |
| tagger   | 40       | stub   | Scryfall oracle tags (`otag:`), retired once bulk ingest writes them per-Card row |

A failing source is silently skipped (logged in dev), so the aggregator
keeps working as long as Scryfall is up. When implementing a stub, also
add its env vars to `.env.example` and document the ToS / rate-limit
caveat in the adapter's leading comment.

### Moxfield import (egress caveat)

`src/lib/moxfield.ts` calls `https://api2.moxfield.com/v3/decks/all/<id>`.
That host is **blocked in sandboxed Claude Code environments** by the
default egress policy — runtime imports will fail with a 403 here.
Locally they work fine. When testing in this environment, use the
paste-mode flow (`{ kind: "paste" }`) instead.

### Article-driven candidate pools

The user's actual decklist (Hearthhull, the Worldseed / World Shaper
precon, BRG) is captured as a plain-text fixture at
`data/decks/hearthhull-world-shaper.txt` — that's the canonical demo
deck for end-to-end tests.

For the broader upgrade-pool (cards the CoolStuffInc article recommends),
there's `data/world-shaper-upgrade-pool.json` and a resolver script
(`scripts/seed-upgrade-pool.ts`). Run with internet access:

```bash
pnpm tsx scripts/seed-upgrade-pool.ts
```

This pattern is the template for future "article-driven" candidate sets —
add a JSON list, point a seed script at it, and the sidebar will surface
those cards (filtered by commander legality, ranked by synergy).

### The "brain" lives in three files, in this order of importance

1. **`src/lib/synergy/score.ts`** — implements the tier algorithm.
   `keywordFrequency` builds the deck's keyword histogram;
   `topThreeKeywords` returns the primary/secondary/tertiary slots;
   `scoreCandidate` assigns each candidate a tier (gold = matches primary,
   silver = secondary, bronze = tertiary, null = no top-3 overlap);
   `rankSuggestions` orders the sidebar — **tier dominates raw share count,
   so a gold-3 ranks above a silver-5 by spec**. Within a tier, rank is by
   share count descending. Untiered cards always come last.

2. **`src/lib/synergy/keywords.ts`** — rules-based keyword extraction from a
   Scryfall card. Combines: (a) Scryfall's printed `keywords[]`, (b) subtypes
   and supertypes parsed out of `type_line` (everything before and after the
   em-dash), (c) `produced_mana` tagged as `produces-{color}`, (d) a curated
   regex pack over `oracle_text` for ~30 high-signal templates Scryfall doesn't
   tag (etb-trigger, ramp, token-maker, board-wipe, draw, etc.). All
   keywords are normalized to lower-kebab-case. Noise tokens like
   `legendary` / `basic` are dropped.

3. **`src/lib/scryfall.ts`** — thin Scryfall API client. `getCardByName` for
   exact lookups, `searchCards` for paged queries, `toCardSummary` for the
   logical-shape projection used by the rest of the app. Always sends the
   custom `User-Agent` (env: `SCRYFALL_USER_AGENT`) per Scryfall's policy.
   `sleep(120)` between paged calls.

### Database schema (`prisma/schema.prisma`)

- **`Card`** — one row per oracle card (id = Scryfall `oracle_id`).
  Stores Scryfall fields plus a **denormalized JSON `keywordsJson`** field
  produced by `extractKeywords`. JSON-in-SQLite is a deliberate choice; if
  we move to Postgres, replace with a `keywords text[]` column and a
  many-to-many join.
- **`Deck`** + **`DeckCard`** — straightforward deck contents with quantity.
  Deck.format is freeform for v1; format-aware filtering is roadmap.

### UI

- **App Router** (Next.js 14). Server components do the data loading, client
  components own interactivity.
- **`src/app/deck/[id]/page.tsx`** is a server component — it queries the deck,
  pulls a candidate pool (currently "all DB cards not in the deck", capped at
  500), ranks them via `rankCandidates`, and ships the top 50 to the sidebar.
- **`src/components/SynergyMap.tsx`** must be `dynamic({ ssr: false })` —
  Cytoscape touches `window`.
- Tier visual tokens (Tailwind classes for borders/badges) live in
  **`src/lib/synergy/tiers.ts`** so the UI layer has a stable, single
  source of truth for tier styling without coupling to the scoring logic.

### Candidate pool

The candidate pool for a deck's suggestions comes from the local DB only.
That means **the quality of suggestions depends on what's been ingested**:

- After `pnpm seed`: ~20 demo cards. Useful for verifying the UI flow.
- After `pnpm ingest`: full Scryfall oracle corpus (~30k cards), ranked.

The `/api/decks` route auto-fetches each pasted card from Scryfall if it
isn't already in the DB, so the deck itself is always complete — but
sidebar suggestions are limited to whatever's been ingested.

## Conventions

- **Path alias**: `@/*` → `src/*` (configured in `tsconfig.json` and `vitest.config.ts`).
- **Tests** live next to the file under test as `*.test.ts`. Vitest picks
  them up via the `include` pattern in `vitest.config.ts`.
- **Keyword strings are lower-kebab-case** everywhere — both stored in the
  DB and rendered as graph node IDs. If you add a new extraction source,
  pipe through `normalizeKeyword`.
- **Server-only data** (Prisma, Scryfall fetches) stays in
  `src/lib/{db,scryfall}.ts` and is consumed only by server components and
  route handlers. Client components receive serializable plain objects
  (e.g. `CardSummary`, `SynergySuggestion`).
- **Scryfall politeness**: any new code path that fans out to the API
  should reuse `lib/scryfall.ts` and `sleep()` between batched calls.
  Identify the client via `SCRYFALL_USER_AGENT`.

## v2 / roadmap notes (relevant context for design decisions)

- **Scryfall oracle tags** (`otag:`, `function:`) are the highest-value
  next addition to keyword extraction — community-maintained synergy
  taxonomy. Plumb into `extractKeywords` once we add Tagger ingestion.
- **EDHREC "lift"** (https://edhrec.com/articles/from-synergy-to-lift-the-math-behind-edhrecs-new-era)
  is a co-occurrence statistic; treat it as a server-side enrichment
  cached locally, not a hard dependency. Attribution required.
- **Compound nodes** in Cytoscape would group keyword nodes into strategy
  clusters (ramp / removal / value / combo / interaction / quality) —
  matching the six-axis framing from neocalculators.
