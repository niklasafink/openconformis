import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { appendAuditEvent } from "@/server/audit/event";
import { deleteTemporaryCredentialsForBinding } from "@/server/ai/credential-cleanup";
import { db } from "@/server/db/client";
import { sponsoredRunGrants } from "@/server/db/schema/application";
import { analyses } from "@/server/db/schema/analyses";

export type AnalysisFailure = {
  /** Fachlicher Fehlercode; der Standard bedeutet „alle Versuche verbraucht". */
  failureCode?: string;
  /** Gekürzte Begründung des Anbieters, falls vorhanden. */
  failureDetail?: string;
};

export async function markAnalysisRetriesExhausted(
  analysisId: string,
  failure: AnalysisFailure = {},
) {
  const result = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${analysisId}, 0))`,
    );
    const [analysis] = await transaction
      .select({
        id: analyses.id,
        status: analyses.status,
        organizationId: analyses.organizationId,
        ownerUserId: analyses.ownerUserId,
        sourceDraftId: analyses.sourceDraftId,
        sponsoredGrantId: analyses.sponsoredGrantId,
        fundingMode: analyses.fundingMode,
        failureDetail: analyses.failureDetail,
      })
      .from(analyses)
      .where(eq(analyses.id, analysisId))
      .limit(1);
    if (!analysis) {
      return { changed: false as const, cleanupCredential: false as const };
    }
    if (analysis.status !== "queued" && analysis.status !== "running") {
      return {
        changed: false as const,
        cleanupCredential:
          analysis.fundingMode === "byok" &&
          (analysis.status === "failed" || analysis.status === "cancelled"),
        sourceDraftId: analysis.sourceDraftId,
        ownerUserId: analysis.ownerUserId,
      };
    }

    const failedAt = new Date();
    const [failed] = await transaction
      .update(analyses)
      .set({
        status: "failed",
        // Wurde im Schritt bereits eine Anbieterbegründung festgehalten, war der
        // Lauf nicht an erschöpften Versuchen, sondern an einer Ablehnung gescheitert.
        failureCode:
          failure.failureCode ??
          (analysis.failureDetail ? "PROVIDER_REJECTED" : "ANALYSIS_RETRIES_EXHAUSTED"),
        // Ein im Schritt erfasstes Anbieterdetail nicht durch null ersetzen.
        ...(failure.failureDetail ? { failureDetail: failure.failureDetail } : {}),
        updatedAt: failedAt,
      })
      .where(and(eq(analyses.id, analysis.id), inArray(analyses.status, ["queued", "running"])))
      .returning({ id: analyses.id });
    if (!failed) return { changed: false as const, cleanupCredential: false as const };

    if (analysis.sponsoredGrantId) {
      await transaction
        .update(sponsoredRunGrants)
        .set({
          status: "available",
          reservedUntil: null,
          revision: sql`${sponsoredRunGrants.revision} + 1`,
          updatedAt: failedAt,
        })
        .where(
          and(
            eq(sponsoredRunGrants.id, analysis.sponsoredGrantId),
            eq(sponsoredRunGrants.status, "reserved"),
          ),
        );
    }

    await appendAuditEvent(transaction, {
      organizationId: analysis.organizationId,
      actorUserId: analysis.ownerUserId,
      anonymousDraftId: analysis.sourceDraftId,
      action: "analysis.failed",
      targetType: "analysis",
      targetId: analysis.id,
      metadata: {
        failureCode:
          failure.failureCode ??
          (analysis.failureDetail ? "PROVIDER_REJECTED" : "ANALYSIS_RETRIES_EXHAUSTED"),
        ...(failure.failureDetail ? { failureDetail: failure.failureDetail } : {}),
      },
    });
    return {
      changed: true as const,
      cleanupCredential: analysis.fundingMode === "byok",
      fundingMode: analysis.fundingMode,
      sourceDraftId: analysis.sourceDraftId,
      ownerUserId: analysis.ownerUserId,
    };
  });

  if (result.cleanupCredential && result.sourceDraftId && result.ownerUserId) {
    await deleteTemporaryCredentialsForBinding({
      purpose: "analysis",
      bindingId: result.sourceDraftId,
      ownerUserId: result.ownerUserId,
    });
  }
  return { changed: result.changed };
}
