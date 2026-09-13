import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { checkByokEncryptionConfig } from "@/domain/operations/production-config";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { getOperationalReadiness } from "@/server/operations/monitoring";

export const dynamic = "force-dynamic";

/**
 * Ein kaputt gespeicherter BYOK-Schlüssel sperrt jede Schlüsselverbindung der
 * Nutzer. Der Health-Check meldet ihn deshalb selbst — nur mit Variablennamen,
 * nie mit Werten, denn der Endpunkt ist öffentlich.
 */
function byokReadiness() {
  const issues = checkByokEncryptionConfig(process.env).map(({ variable }) => variable);
  return issues.length === 0
    ? ({ byok: "ready" } as const)
    : ({ byok: "not_configured", byokIssues: issues } as const);
}

export async function GET() {
  const byok = byokReadiness();

  if (!isDatabaseConfigured) {
    return NextResponse.json(
      {
        status: "degraded",
        database: "not_configured",
        ...byok,
      },
      { status: 503 },
    );
  }

  try {
    await db.execute(sql`select 1`);
    const operations = await getOperationalReadiness();
    const healthy = byok.byok === "ready";

    return NextResponse.json(
      {
        status: healthy ? "ok" : "degraded",
        database: "reachable",
        workflow: operations.workflowReady ? "ready" : "unavailable",
        ...byok,
      },
      { status: healthy ? 200 : 503 },
    );
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        ...byok,
      },
      { status: 503 },
    );
  }
}
