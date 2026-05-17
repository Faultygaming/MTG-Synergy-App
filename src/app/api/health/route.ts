import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Force per-request execution. Without this Next prerenders the route at
// build time and the response (including the DB ping result) is baked
// into a static file, defeating the point of a liveness probe.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/health
//
// Liveness + readiness probe used by Docker's HEALTHCHECK and by uptime
// monitors on the LAN host. Returns 200 + JSON if the SQLite DB is
// reachable and the schema is initialized. Returns 503 otherwise so the
// container is restarted by the orchestrator.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      version: process.env.APP_VERSION ?? "dev",
      commit: process.env.APP_COMMIT ?? "unknown",
      builtAt: process.env.APP_BUILT_AT ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "unknown" },
      { status: 503 },
    );
  }
}
