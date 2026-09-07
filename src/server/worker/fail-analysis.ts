import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { appendAuditEvent } from "@/server/audit/event";
import { deleteTemporaryCredentialsForBinding } from "@/server/ai/credential-cleanup";
import { db } from "@/server/db/client";
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
        failureDetail: analyses.failureDetail,
      })
      .from(analyses)
      .where(eq(analyses.id, analysisId))
      .limit(1);
    if (!analysis) return { changed: false as const };
    if (analysis.status !== "queued" && analysis.status !== "running") {
      // Ein bereits beendeter Lauf braucht seinen Schlüssel nicht mehr — auch
      // dann nicht, wenn dieser Aufruf ihn nicht selbst beendet hat.
      return {
        changed: false as const,
        cleanupCredential: analysis.status === "failed" || analysis.status === "cancelled",
        sourceDraftId: analysis.sourceDraftId,
        ownerUserId: analysis.ownerUserId,
      };
    }

    // Wurde im Schritt bereits eine Anbieterbegründung festgehalten, war der
    // Lauf nicht an erschöpften Versuchen, sondern an einer Ablehnung gescheitert.
    const failureCode =
      failure.failureCode ??
      (analysis.failureDetail ? "PROVIDER_REJECTED" : "ANALYSIS_RETRIES_EXHAUSTED");
    const [failed] = await transaction
      .update(analyses)
      .set({
        status: "failed",
        failureCode,
        // Ein im Schritt erfasstes Anbieterdetail nicht durch null ersetzen.
        ...(failure.failureDetail ? { failureDetail: failure.failureDetail } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(analyses.id, analysis.id), inArray(analyses.status, ["queued", "running"])))
      .returning({ id: analyses.id });
    if (!failed) return { changed: false as const };

    await appendAuditEvent(transaction, {
      organizationId: analysis.organizationId,
      actorUserId: analysis.ownerUserId,
      anonymousDraftId: analysis.sourceDraftId,
      action: "analysis.failed",
      targetType: "analysis",
      targetId: analysis.id,
      metadata: {
        failureCode,
        ...(failure.failureDetail ? { failureDetail: failure.failureDetail } : {}),
      },
    });
    return {
      changed: true as const,
      cleanupCredential: true,
      sourceDraftId: analysis.sourceDraftId,
      ownerUserId: analysis.ownerUserId,
    };
  });

  if (result.cleanupCredential) {
    await deleteTemporaryCredentialsForBinding({
      purpose: "analysis",
      bindingId: result.sourceDraftId,
      ownerUserId: result.ownerUserId,
    });
  }
  return { changed: result.changed };
}
