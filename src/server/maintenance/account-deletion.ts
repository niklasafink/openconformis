import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { analyses } from "@/server/db/schema/analyses";
import { policies, policyVersions } from "@/server/db/schema/documents";

export async function prepareAccountDeletion(userId: string) {
  await db.transaction(async (transaction) => {
    const ownedAnalyses = await transaction
      .select({
        id: analyses.id,
        organizationId: analyses.organizationId,
        policyVersionId: analyses.policyVersionId,
      })
      .from(analyses)
      .where(eq(analyses.ownerUserId, userId));

    if (ownedAnalyses.length > 0) {
      await transaction.delete(analyses).where(
        inArray(
          analyses.id,
          ownedAnalyses.map(({ id }) => id),
        ),
      );
    }

    const versionIds = [...new Set(ownedAnalyses.map(({ policyVersionId }) => policyVersionId))];
    if (versionIds.length > 0) {
      const deletableVersions = await transaction
        .select({ id: policyVersions.id, policyId: policyVersions.policyId })
        .from(policyVersions)
        .where(
          and(
            inArray(policyVersions.id, versionIds),
            sql`NOT EXISTS (
            SELECT 1 FROM analyses WHERE analyses.policy_version_id = ${policyVersions.id}
          )`,
          ),
        );
      if (deletableVersions.length > 0) {
        const now = new Date();
        await transaction
          .update(policyVersions)
          .set({ parseStatus: "deleting", deletionRequestedAt: now })
          .where(
            inArray(
              policyVersions.id,
              deletableVersions.map(({ id }) => id),
            ),
          );
        await transaction
          .update(policies)
          .set({ lifecycleStatus: "deleting", deletionRequestedAt: now, updatedAt: now })
          .where(
            inArray(
              policies.id,
              deletableVersions.map(({ policyId }) => policyId),
            ),
          );
      }
    }

    for (const analysis of ownedAnalyses) {
      await appendAuditEvent(transaction, {
        organizationId: analysis.organizationId,
        actorUserId: userId,
        action: "account.analysis_access_revoked",
        targetType: "analysis",
        targetId: analysis.id,
      });
    }
  });
}
