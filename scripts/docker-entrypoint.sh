#!/bin/sh
# Container entrypoint.
#
# Boots in this order:
#   1. mkdir the SQLite data dir + apply Prisma schema (db push)
#   2. seed the bundled fixtures (idempotent, fast)
#   3. fork an auto-ingest loop:
#        • once now, then every $INGEST_INTERVAL_SECS (default 900 = 15min)
#        • each iteration: `ingest` then `ingest-tags`
#        • `ingest` short-circuits when Scryfall's bulk hasn't changed
#          (data/.ingest-state.json), so 99% of iterations cost ~1s
#        • disable via AUTO_INGEST=0
#   4. exec the Next.js server (`node server.js`)
#
# Env vars:
#   DATABASE_URL          file: URL of the SQLite DB (defaults to data/)
#   AUTO_INGEST           "0" disables the background loop (default "1")
#   INGEST_INTERVAL_SECS  poll interval, default 900 (15 minutes)
#   APP_VERSION/COMMIT/BUILT_AT  surfaced by /api/health
#
# The auto-ingest loop logs to /app/data/ingest.log so the operator can
# tail it: `docker compose exec app tail -f /app/data/ingest.log`
set -eu

# Strip the optional file: prefix so we can mkdir the directory.
RAW_DB="${DATABASE_URL:-file:./data/synergy.db}"
DB_PATH="${RAW_DB#file:}"
mkdir -p "$(dirname "$DB_PATH")"

echo "[entrypoint] applying schema to ${RAW_DB}"
# Prisma 7 simplified the `db push` CLI: --skip-generate was removed
# (regeneration is decided automatically), and --accept-data-loss is now
# a flag-only switch with absence = refuse. So this call:
#   - reads DATABASE_URL via prisma.config.ts
#   - applies the schema non-destructively (would error if it required
#     dropping a column / data)
#   - skips re-generation because the client is already present from the
#     build stage's `prisma generate`
node /app/node_modules/prisma/build/index.js db push

# Seed bundled fixture cards (~20 cards from seeds/fixtures.json). The
# script is idempotent — if the rows already exist (typically after an
# `ingest`), it just refreshes their computed keyword arrays. ~200ms.
if command -v seed >/dev/null 2>&1; then
  echo "[entrypoint] seeding bundled fixtures"
  seed || echo "[entrypoint] seed failed; continuing"
fi

# Background ingest loop. Runs immediately (first time after a fresh
# container start, this is the only way to populate the corpus) and
# then every $INGEST_INTERVAL_SECS. Both `ingest` and `ingest-tags`
# already have their own short-circuit logic (ingest-state.json + the
# precomputed seeds/oracle-tags-map.json), so this is cheap when there's
# nothing new to apply.
if [ "${AUTO_INGEST:-1}" = "1" ] && command -v ingest >/dev/null 2>&1; then
  INTERVAL="${INGEST_INTERVAL_SECS:-900}"
  echo "[entrypoint] auto-ingest enabled — first run in 10s, then every ${INTERVAL}s (disable with AUTO_INGEST=0)"
  (
    LOG="${DB_PATH%/*}/ingest.log"
    mkdir -p "$(dirname "$LOG")"
    # First pass after boot — give the server a head start so the user
    # can land on the page even before the corpus is populated.
    sleep 10
    while true; do
      {
        echo "=== [$(date -u +%Y-%m-%dT%H:%M:%SZ)] ingest start"
        ingest || echo "(ingest failed)"
        echo "=== [$(date -u +%Y-%m-%dT%H:%M:%SZ)] ingest-tags start"
        ingest-tags || echo "(ingest-tags failed)"
        echo "=== [$(date -u +%Y-%m-%dT%H:%M:%SZ)] done"
        echo
      } >> "$LOG" 2>&1
      sleep "$INTERVAL"
    done
  ) &
else
  echo "[entrypoint] auto-ingest disabled (AUTO_INGEST=${AUTO_INGEST:-1})"
fi

echo "[entrypoint] starting ${APP_VERSION:-dev} (${APP_COMMIT:-unknown})"
exec "$@"
