import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, isDatabaseConfigured } from "@/server/db/client";
import { getOperationalReadiness } from "@/server/operations/monitoring";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDatabaseConfigured) {
    return NextResponse.json(
      {
        status: "degraded",
        database: "not_configured",
      },
      { status: 503 },
    );
  }

  try {
    await db.execute(sql`select 1`);
    const operations = await getOperationalReadiness();
    const workerRequired = process.env.WORKER_REQUIRED === "true";
    if (workerRequired && !operations.workerFresh) {
      return NextResponse.json(
        { status: "degraded", database: "reachable", worker: "stale" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json({
      status: "ok",
      database: "reachable",
      worker: operations.workerFresh ? "ready" : "not_required",
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
      },
      { status: 503 },
    );
  }
}
