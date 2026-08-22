import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { appendAuditEvent } from "@/server/audit/event";
import { requireSessionPrincipal } from "@/server/auth/session-principal";
import { db } from "@/server/db/client";
import { analyses } from "@/server/db/schema/analyses";
import { policies, policyVersions } from "@/server/db/schema/documents";

export async function requestAnalysisDeletion(unvalidatedId: string) {
  const [principal, analysisId] = await Promise.all([
    requireSessionPrincipal(),
    Promise.resolve(z.string().uuid().parse(unvalidatedId)),
  ]);
  return db.transaction(async (transaction) => {
    const [analysis] = await transaction
      .select({
        id: analyses.id,
        policyVersionId: analyses.policyVersionId,
        policyId: policyVersions.policyId,
      })
      .from(analyses)
      .innerJoin(policyVersions, eq(policyVersions.id, analyses.policyVersionId))
      .where(
        and(
          eq(analyses.id, analysisId),
          eq(analyses.organizationId, principal.organizationId),
          eq(analyses.ownerUserId, principal.userId),
        ),
      )
      .limit(1);
    if (!analysis) throw new Error("ANALYSIS_NOT_FOUND");

    await transaction.delete(analyses).where(eq(analyses.id, analysis.id));
    const [remaining] = await transaction
      .select({ count: sql<number>`count(*)::integer` })
      .from(analyses)
      .where(eq(analyses.policyVersionId, analysis.policyVersionId));
    const now = new Date();
    if ((remaining?.count ?? 0) === 0) {
      await transaction
        .update(policyVersions)
        .set({ parseStatus: "deleting", deletionRequestedAt: now })
        .where(eq(policyVersions.id, analysis.policyVersionId));
      await transaction
        .update(policies)
        .set({ lifecycleStatus: "deleting", deletionRequestedAt: now, updatedAt: now })
        .where(eq(policies.id, analysis.policyId));
    }
    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "analysis.deletion_requested",
      targetType: "analysis",
      targetId: analysis.id,
    });
    return { id: analysis.id, deletionStatus: "access_revoked" as const };
  });
}
