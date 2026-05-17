import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Prisma 7 requires a driver adapter to be passed to the PrismaClient
// constructor — the old `datasource.url = env("DATABASE_URL")` pattern is
// gone. We strip the optional `file:` prefix from DATABASE_URL so the
// adapter receives a bare path that better-sqlite3 accepts directly.
function adapter(): PrismaBetterSqlite3 {
  const raw = process.env.DATABASE_URL ?? "file:./data/synergy.db";
  const url = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  return new PrismaBetterSqlite3({ url });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: adapter(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
