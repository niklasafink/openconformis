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

    return NextResponse.json({
      status: "ok",
      database: "reachable",
      workflow: operations.workflowReady ? "ready" : "unavailable",
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
