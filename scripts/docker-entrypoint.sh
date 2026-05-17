#!/bin/sh
# Container entrypoint.
#
# Applies the Prisma schema to the SQLite DB at $DATABASE_URL, then execs
# whatever command was passed in (default: `node server.js`).
#
# `prisma db push` is idempotent — on second+ runs it's a no-op as long as
# the schema is already in sync. We use it instead of `migrate deploy`
# because the project doesn't ship a migrations directory; if/when that
# changes, swap this for `prisma migrate deploy`.
#
# --skip-generate: the client is already in node_modules/.prisma from the
#                  build stage, so don't regenerate at startup.
# --accept-data-loss=false: refuses to drop columns / data silently. We
#                  want startup to fail loudly if a migration is needed
#                  that can't be applied non-destructively.
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

echo "[entrypoint] starting ${APP_VERSION:-dev} (${APP_COMMIT:-unknown})"
exec "$@"
