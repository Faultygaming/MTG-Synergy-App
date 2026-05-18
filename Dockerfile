# syntax=docker/dockerfile:1.7
#
# MTG Synergy Map — single-image Docker build.
#
# Three stages keep the runtime image small (~250 MB):
#   1. deps    — install pnpm deps using the project's preinstall guard.
#   2. builder — generate the Prisma client and build Next.js in standalone mode.
#   3. runner  — minimal runtime with the standalone server + Prisma CLI.
#
# IMPORTANT: pnpm is forced into "hoisted" node-linker mode inside the
# build (via npm_config_node_linker). Without this, node_modules is laid
# out with symlinks into .pnpm/, and Docker `COPY --from=builder
# /app/node_modules` between stages produces dangling symlinks. Hoisted
# layout is npm-style flat, so the COPY works cleanly. Local dev keeps
# pnpm's default isolated mode; this env var only affects Docker builds.
#
# Build args injected by CI so the running container reports its own version:
#   APP_VERSION   e.g. v0.1.0 or sha-abc1234
#   APP_COMMIT    full git SHA
#   APP_BUILT_AT  ISO-8601 build timestamp
#
# Volumes:
#   /app/data    SQLite DB + any bulk Scryfall downloads. Mount this so
#                the DB survives container restarts and image upgrades.
#
# Watchtower compatibility: the image declares the
# org.opencontainers.image.* labels and the runtime is stateless apart
# from /app/data, so a pull+restart is a safe upgrade path.

# ──────────────────────────────────────────────────────────────────────
# deps: install pnpm deps with the project's preinstall guard
# ──────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

# Force flat (npm-style) node_modules for Docker portability.
ENV npm_config_node_linker=hoisted

# The preinstall guard (scripts/check-package-manager.mjs) refuses any
# package manager other than pnpm. We pre-copy it so install doesn't fail.
COPY package.json pnpm-lock.yaml .npmrc ./
COPY scripts/check-package-manager.mjs ./scripts/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ──────────────────────────────────────────────────────────────────────
# builder: prisma generate + next build (standalone), then prune devDeps
# ──────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_node_linker=hoisted

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma's generated client must exist before `next build` so server
# components that import it type-check and bundle correctly.
RUN pnpm prisma generate

RUN pnpm build

# Drop devDeps so the runner stage gets a slim node_modules.
# `prisma` (the CLI) is intentionally listed as a runtime dependency so
# `prisma db push` is available at container startup.
RUN pnpm prune --prod

# ──────────────────────────────────────────────────────────────────────
# runner: minimal runtime
# ──────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# tini: PID 1 + signal handling. ca-certificates: outbound HTTPS to
# Scryfall + GHCR. wget: used by HEALTHCHECK. Switched away from Alpine
# because better-sqlite3 (Prisma 7's SQLite driver adapter dependency)
# ships prebuilt glibc binaries only — Alpine's musl would require
# building from source.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/app/data/synergy.db"

# Build-arg → ENV passthrough so /api/health can report what's running.
ARG APP_VERSION=dev
ARG APP_COMMIT=unknown
ARG APP_BUILT_AT=
ENV APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT} \
    APP_BUILT_AT=${APP_BUILT_AT}

# Debian-style user creation (the Alpine `addgroup -S` flags don't apply here).
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

# Next.js standalone bundle: provides /app/server.js + a minimal traced
# /app/node_modules suitable for Next's runtime.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Overlay the standalone node_modules with the full pruned-prod tree
# from the builder. Standalone's tree is a subset that's optimized for
# Next's server only; the full prod tree includes the Prisma CLI plus
# every transitive dep it needs at startup. Hoisted layout means each
# package is a real directory, not a symlink to .pnpm/.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Prisma schema + config for `db push` at startup.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

# Maintenance scripts + their bundled fixture data. /app/seeds is
# distinct from /app/data — the latter is the runtime VOLUME mount so
# anything we put under it gets hidden once the user mounts a volume.
# Read-only seed fixtures live in /app/seeds; SQLite + Scryfall bulk
# downloads live in /app/data. src/ + tsconfig are needed because the
# scripts import from src/lib/ via the @/ path alias.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/seeds ./seeds
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

# Convenience wrappers so operators can type `seed`, `ingest`,
# `ingest-tags` inside `docker compose exec app sh` instead of the full
# `node /app/node_modules/tsx/dist/cli.mjs /app/scripts/<name>.ts`.
COPY --chmod=755 scripts/docker-bin/seed /usr/local/bin/seed
COPY --chmod=755 scripts/docker-bin/ingest /usr/local/bin/ingest
COPY --chmod=755 scripts/docker-bin/ingest-tags /usr/local/bin/ingest-tags
COPY --chmod=755 scripts/docker-bin/reextract-keywords /usr/local/bin/reextract-keywords
COPY --chmod=755 scripts/docker-bin/analyze-keywords /usr/local/bin/analyze-keywords

# Persistent SQLite + downloads location. Declared as a VOLUME so an
# operator who forgets to mount one still gets a stable named volume.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME ["/app/data"]

COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --spider --quiet http://127.0.0.1:3000/api/health || exit 1

# OCI labels — surfaced by docker inspect / GHCR / Watchtower.
LABEL org.opencontainers.image.title="MTG Synergy Map" \
      org.opencontainers.image.description="Word-map style synergy explorer and deck builder for MTG" \
      org.opencontainers.image.source="https://github.com/Faultygaming/MTG-Synergy-App" \
      org.opencontainers.image.licenses="UNLICENSED"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
