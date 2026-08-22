import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { requireCatalogueAdministrator } from "@/server/catalogue/administrator";
import { db } from "@/server/db/client";
import { analyses } from "@/server/db/schema/analyses";
import { jobOutbox, workerHeartbeats } from "@/server/db/schema/jobs";

const workerMaximumAgeMilliseconds = 120_000;

export async function recordWorkerHeartbeat(input: {
  workerId: string;
  buildId: string;
  startedAt: Date;
  healthy?: boolean;
  safeStatus?: string;
}) {
  const now = new Date();
  await db
    .insert(workerHeartbeats)
    .values({
      workerId: input.workerId,
      buildId: input.buildId,
      startedAt: input.startedAt,
      lastSeenAt: now,
      healthy: input.healthy ?? true,
      safeStatus: input.safeStatus ?? "running",
    })
    .onConflictDoUpdate({
      target: workerHeartbeats.workerId,
      set: {
        buildId: input.buildId,
        lastSeenAt: now,
        healthy: input.healthy ?? true,
        safeStatus: input.safeStatus ?? "running",
      },
    });
}

export async function getOperationalReadiness() {
  const [heartbeat, pending] = await Promise.all([
    db
      .select({ lastSeenAt: workerHeartbeats.lastSeenAt, healthy: workerHeartbeats.healthy })
      .from(workerHeartbeats)
      .orderBy(desc(workerHeartbeats.lastSeenAt))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::integer` })
      .from(jobOutbox)
      .where(eq(jobOutbox.status, "pending")),
  ]);
  const latest = heartbeat[0];
  const workerFresh = Boolean(
    latest?.healthy && Date.now() - latest.lastSeenAt.getTime() <= workerMaximumAgeMilliseconds,
  );
  return { workerFresh, pendingJobs: pending[0]?.count ?? 0 };
}

export async function getAdminOperationsSnapshot() {
  await requireCatalogueAdministrator();
  const [workers, queueCounts, analysisCounts, oldestPending] = await Promise.all([
    db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastSeenAt)).limit(10),
    db
      .select({ status: jobOutbox.status, count: sql<number>`count(*)::integer` })
      .from(jobOutbox)
      .groupBy(jobOutbox.status),
    db
      .select({ status: analyses.status, count: sql<number>`count(*)::integer` })
      .from(analyses)
      .groupBy(analyses.status),
    db
      .select({ createdAt: jobOutbox.createdAt })
      .from(jobOutbox)
      .where(eq(jobOutbox.status, "pending"))
      .orderBy(jobOutbox.createdAt)
      .limit(1),
  ]);
  return {
    workers: workers.map((worker) => ({
      ...worker,
      fresh:
        worker.healthy && Date.now() - worker.lastSeenAt.getTime() <= workerMaximumAgeMilliseconds,
    })),
    queueCounts,
    analysisCounts,
    oldestPendingAt: oldestPending[0]?.createdAt ?? null,
    generatedAt: new Date(),
  };
}
