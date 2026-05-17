// Prisma 7 configuration.
//
// Migrate-time settings live here (Prisma 7 removed `url` from schema.prisma).
// Runtime PrismaClient construction lives in src/lib/db.ts and passes the
// SQLite driver adapter directly to the constructor.
//
// Docs: https://www.prisma.io/docs/orm/reference/prisma-config-reference

import { defineConfig } from "prisma/config";

// Normalize "file:" URLs to the bare path that better-sqlite3 expects.
// Prisma 6 and earlier used `file:./data/...` (resolved relative to the
// schema file's directory). The new adapter takes a path directly, so we
// strip the prefix and let it be resolved relative to cwd.
function dbUrl(): string {
  const raw = process.env.DATABASE_URL ?? "file:./data/synergy.db";
  return raw;
}

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: dbUrl(),
  },
});
