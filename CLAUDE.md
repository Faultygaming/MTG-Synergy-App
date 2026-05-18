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
pnpm lint               # eslint .
pnpm test               # vitest run
pnpm test path/to/file  # single test file
pnpm test -t "tier"     # filter by test name substring
pnpm validate           # lint + typecheck + test + build — MUST pass before pushing
pnpm db:push            # apply prisma/schema.prisma to ./data/synergy.db
pnpm db:studio          # open Prisma Studio
pnpm seed               # load seeds/fixtures.json (~20 demo cards)
pnpm ingest [--force]   # bulk-ingest Scryfall oracle_cards (~120MB download)
pnpm ingest:tags [tag…] # ingest Scryfall oracle tags (otag:) for the curated list in seeds/oracle-tags.json (or a subset). Network-bound; run after `pnpm ingest`.
```

**Pre-push discipline**: always run `pnpm validate` before `git push`.
Skipping `pnpm lint` (which catches react/no-unescaped-entities and
similar JSX issues that typecheck doesn't) has caused CI failures in
the past. The `validate` script bundles the four checks CI will run
into one command — green here means green there.

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

Current runtime sources:

| Source   | Priority | Status | Purpose |
|----------|----------|--------|---------|
| scryfall | 10       | live   | Canonical card data, images, printed keywords |
| mtgjson  | 20       | stub   | EDHREC rank, ruling provenance, alt-name lookup |
| edhrec   | 30       | stub   | Lift / co-occurrence stats for synergy scoring |

The Scryfall **Tagger** is NOT a runtime source — its oracle tags are
ingested once via `pnpm ingest:tags` (script: `scripts/ingest-oracle-tags.ts`)
and persisted on `Card.oracleTagsJson`. `extractKeywords()` accepts these
as a second argument and unions them in as `otag:*` keywords. To refresh
tags: re-run `pnpm ingest:tags` (the seed/ingest scripts preserve existing
tags during a Scryfall refresh).

A failing runtime source is silently skipped (logged in dev), so the
aggregator keeps working as long as Scryfall is up. When implementing a
stub, also add its env vars to `.env.example` and document the ToS /
rate-limit caveat in the adapter's leading comment.

### Moxfield import (egress caveat)

`src/lib/moxfield.ts` calls `https://api2.moxfield.com/v3/decks/all/<id>`.
That host is **blocked in sandboxed Claude Code environments** by the
default egress policy — runtime imports will fail with a 403 here.
Locally they work fine. When testing in this environment, use the
paste-mode flow (`{ kind: "paste" }`) instead.

### Article-driven candidate pools

The user's actual decklist (Hearthhull, the Worldseed / World Shaper
precon, BRG) is captured as a plain-text fixture at
`seeds/decks/hearthhull-world-shaper.txt` — that's the canonical demo
deck for end-to-end tests.

For the broader upgrade-pool (cards the CoolStuffInc article recommends),
there's `seeds/world-shaper-upgrade-pool.json` and a resolver script
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

### Self-validating SynergyMap changes

`scripts/preview-map.ts` (npm script: `pnpm preview:map <deck-id>`) runs
the same cose-bilkent layout headlessly and writes `data/map-preview.svg`,
which mirrors what the browser will show. Use this loop when iterating
on visual code in `src/components/SynergyMap.tsx`:

```bash
pnpm seed                            # ensure fixtures are in the DB
pnpm tsx scripts/seed-preview-deck.ts  # produces a deck id
pnpm preview:map <deck-id>           # writes data/map-preview.svg
```

The math (sizing, tier classification, edge derivation) lives in
`src/lib/synergy/map.ts` so the React component and the preview script
stay in sync — change one, change both. If they diverge, the preview is
lying.

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

## Stack versions (latest-stable as of May 2026)

Major-version pins worth knowing:

| Lib              | Version | Notes |
|------------------|---------|-------|
| Next.js          | 16.x    | App Router; **`params` is now `Promise<…>`** in dynamic routes; `serverComponentsExternalPackages` renamed to `serverExternalPackages`; `next lint` removed (use `eslint .` against the flat config). |
| React            | 19.x    | Stable. No code changes needed beyond `@types/react@19`. |
| Prisma           | 7.x     | **`url` removed from `schema.prisma`** — now in `prisma.config.ts`. Runtime requires a driver adapter: see `src/lib/db.ts` which wires `@prisma/adapter-better-sqlite3`. The CLI reads URL from `prisma.config.ts`. |
| Tailwind CSS     | 4.x     | **No `tailwind.config.ts`** — design tokens live in CSS `@theme { ... }` directives in `src/app/globals.css`. PostCSS plugin renamed to `@tailwindcss/postcss`. Autoprefixer no longer needed. |
| Zod              | 4.x     | Current usage is compatible — `z.union`, `z.object`, `z.enum`, `z.literal`. |
| Vitest           | 4.x     | Bench API used in `*.bench.ts` is experimental — pin Vitest before relying on it. |
| ESLint           | 9.x     | Flat config at `eslint.config.mjs`; `eslint-config-next@16` re-exports flat-compatible configs. Pinned at 9 because 10 isn't yet supported by eslint-config-next's transitive plugins. |
| TypeScript       | 6.x     | No new issues surfaced. |

## Performance: synergy hot path

Benchmarks (Vitest bench) live next to the code in `*.bench.ts`. Run
with `pnpm vitest bench`. The two paths worth tracking:

- **`rankCandidates(candidates, deck)`** — runs on every deck-page render
  against the candidate pool (capped at 2000). After the May 2026
  optimization (single-pass scoring + hoisted deck-keyword Set), this is
  ~3.0 ms at 2000 candidates on a developer laptop. Don't regress this:
  the previous naive version was 23 ms, visibly affecting TTFB.
- **`extractKeywords(card)`** — runs at ingest time. ~4 µs for a light
  card, ~11 µs worst-case. Full Scryfall corpus (~30 k cards) extracts
  in ~250 ms total — negligible vs the network time for the bulk
  download.

If you touch `src/lib/synergy/score.ts` or `keywords.ts`, re-run
`pnpm vitest bench src/lib/synergy/` and check the delta.

## Docker deployment

Single multi-arch image published to GHCR by `.github/workflows/release.yml`
on every push to `main` and on every `v*.*.*` git tag. Watch out for
these things when changing anything Docker-related:

- **node-linker**: the Dockerfile sets `npm_config_node_linker=hoisted`
  in both deps and builder stages, forcing pnpm to use npm-style flat
  layout INSIDE Docker only. Local dev still uses pnpm's default
  isolated mode. Without hoisted layout, the inter-stage
  `COPY /app/node_modules` produces dangling symlinks into `.pnpm/`.
- **`prisma` is a runtime dependency, not a devDep.** It must be
  installed in the production prune because the container's entrypoint
  invokes `prisma db push` at startup to initialize the SQLite schema.
  Don't move it back to devDeps.
- **Next + Prisma**: `next.config.mjs` lists `@prisma/client` and
  `prisma` in `experimental.serverComponentsExternalPackages`. Without
  this, Next's bundler tries to inline Prisma's query engine binary
  and breaks at runtime. If you add new server-side libs with native
  bindings (better-sqlite3, sharp, etc.), add them here too.
- **Health endpoint** at `src/app/api/health/route.ts` must stay
  `export const dynamic = "force-dynamic"`. Without it Next prerenders
  the response at build time, baking in a (possibly stale) DB ping
  result and defeating the probe.
- **`/app/data` volume**: SQLite lives at `/app/data/synergy.db`. Any
  schema change must remain non-destructive (no `--accept-data-loss`)
  so the entrypoint's `prisma db push` doesn't trash user data on
  upgrade.

GHCR image tags written by the release workflow:
`latest` (main), `vX.Y.Z` / `X.Y.Z` / `X.Y` / `X` (semver tags),
`sha-<short>` (every build).

Auto-update on the LAN host is handled by Watchtower in
`docker-compose.yml`; containers opt in via the
`com.centurylinklabs.watchtower.enable=true` label.

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
