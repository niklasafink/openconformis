import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { getRun } from "workflow/api";

import { appendAuditEvent } from "@/server/audit/event";
import {
  deleteAnalysisAssistCredential,
  deleteTemporaryCredentialsForBinding,
} from "@/server/ai/credential-cleanup";
import { db } from "@/server/db/client";
import { analyses } from "@/server/db/schema/analyses";

export class AnalysisCancelError extends Error {
  constructor(public readonly code: "ANALYSIS_NOT_FOUND") {
    super(code);
    this.name = "AnalysisCancelError";
  }
}

/**
 * Stoppt einen wartenden oder laufenden Lauf. Bereits gespeicherte Bewertungen
 * bleiben erhalten; der Schlüssel wird sofort gelöscht, und der Workflow endet
 * spätestens vor der nächsten Anforderung, weil jeder Schritt den Status liest.
 */
export async function cancelOwnedAnalysis(input: { analysisId: string; ownerUserId: string }) {
  const result = await db.transaction(async (transaction) => {
    // Derselbe Lock wie beim Fehlschlag: Stoppen und Scheitern schließen sich aus.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.analysisId}, 0))`,
    );
    const [analysis] = await transaction
      .select({
        id: analyses.id,
        status: analyses.status,
        organizationId: analyses.organizationId,
        sourceDraftId: analyses.sourceDraftId,
        workflowRunId: analyses.workflowRunId,
        jevCredentialId: analyses.jevCredentialId,
      })
      .from(analyses)
      .where(and(eq(analyses.id, input.analysisId), eq(analyses.ownerUserId, input.ownerUserId)))
      .limit(1);
    if (!analysis) throw new AnalysisCancelError("ANALYSIS_NOT_FOUND");
    if (analysis.status !== "queued" && analysis.status !== "running") {
      return { analysis, changed: false };
    }

    const [cancelled] = await transaction
      .update(analyses)
      .set({ status: "cancelled", failureCode: "ANALYSIS_CANCELLED", updatedAt: new Date() })
      .where(and(eq(analyses.id, analysis.id), inArray(analyses.status, ["queued", "running"])))
      .returning({ id: analyses.id });
    if (!cancelled) return { analysis, changed: false };

    await appendAuditEvent(transaction, {
      organizationId: analysis.organizationId,
      actorUserId: input.ownerUserId,
      anonymousDraftId: analysis.sourceDraftId,
      action: "analysis.cancelled",
      targetType: "analysis",
      targetId: analysis.id,
      metadata: { previousStatus: analysis.status },
    });
    return { analysis, changed: true };
  });

  if (result.changed) {
    await deleteTemporaryCredentialsForBinding({
      purpose: "analysis",
      bindingId: result.analysis.sourceDraftId,
      ownerUserId: input.ownerUserId,
    });
    if (result.analysis.jevCredentialId) {
      await deleteAnalysisAssistCredential({
        draftId: result.analysis.sourceDraftId,
        ownerUserId: input.ownerUserId,
      });
    }
    if (result.analysis.workflowRunId) {
      // Nur beschleunigend: auch ohne Abbruch endet der Workflow am Status.
      await getRun(result.analysis.workflowRunId)
        .cancel()
        .catch((error: unknown) => {
          console.error(
            "[analysis-cancel] workflow run could not be cancelled",
            error instanceof Error ? error.name : typeof error,
          );
        });
    }
  }

  return {
    analysisId: result.analysis.id,
    status: result.changed ? ("cancelled" as const) : result.analysis.status,
    changed: result.changed,
  };
}
