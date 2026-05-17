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

DB_DIR="$(dirname "${DATABASE_URL#file:}")"
mkdir -p "$DB_DIR"

echo "[entrypoint] applying schema to ${DATABASE_URL}"
node /app/node_modules/prisma/build/index.js db push \
  --skip-generate \
  --accept-data-loss=false

echo "[entrypoint] starting ${APP_VERSION:-dev} (${APP_COMMIT:-unknown})"
exec "$@"
