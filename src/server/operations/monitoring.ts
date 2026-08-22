import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { requireCatalogueAdministrator } from "@/server/catalogue/administrator";
import { db } from "@/server/db/client";
import { analyses } from "@/server/db/schema/analyses";

export async function getOperationalReadiness() {
  const [pending] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(analyses)
    .where(eq(analyses.status, "queued"));
  return { workflowReady: true, pendingJobs: pending?.count ?? 0 };
}

export async function getAdminOperationsSnapshot() {
  await requireCatalogueAdministrator();
  const [analysisCounts, oldestPending] = await Promise.all([
    db
      .select({ status: analyses.status, count: sql<number>`count(*)::integer` })
      .from(analyses)
      .groupBy(analyses.status),
    db
      .select({ createdAt: analyses.createdAt })
      .from(analyses)
      .where(eq(analyses.status, "queued"))
      .orderBy(asc(analyses.createdAt))
      .limit(1),
  ]);
  return {
    execution: {
      provider: "Vercel Workflow",
      buildId:
        process.env.APP_BUILD_ID?.trim() ||
        process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
        "development",
      status: "managed",
    },
    analysisCounts,
    oldestPendingAt: oldestPending[0]?.createdAt ?? null,
    generatedAt: new Date(),
  };
}
