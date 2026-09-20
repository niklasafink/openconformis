import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { getRun } from "workflow/api";

import { appendAuditEvent } from "@/server/audit/event";
import { deleteTemporaryCredentialsForBinding } from "@/server/ai/credential-cleanup";
import { db } from "@/server/db/client";
import { reviewRuns } from "@/server/db/schema/reviews";

import { cancelReviewChildren } from "./execute-review";
import { requireManagement, resolveReviewActor } from "./review-actor";
import { closeOpenCells } from "./review-cells";

/**
 * Stoppt einen wartenden oder laufenden Lauf. Fertige Zellen bleiben erhalten, offene
 * werden als verlassen geführt. Die Kind-Läufe werden **aktiv** gestoppt — sonst
 * arbeiteten bis zu acht von ihnen noch minutenlang gegen Jev, obwohl niemand mehr
 * auf sie wartet. Der Schlüssel wird sofort gelöscht.
 */
export async function cancelReviewRun(input: {
  reviewRunId: string;
}): Promise<
  | { ok: true; status: string; changed: boolean }
  | { ok: false; code: "REVIEW_RUN_NOT_FOUND" | "REVIEW_FORBIDDEN" | "MEMBERSHIP_REQUIRED" }
> {
  let actor;
  try {
    actor = requireManagement(await resolveReviewActor());
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "REVIEW_FORBIDDEN" || code === "MEMBERSHIP_REQUIRED") return { ok: false, code };
    throw error;
  }

  const result = await db.transaction(async (transaction) => {
    // Derselbe Lock wie beim Abschluss: Stoppen und Beenden schliessen sich aus.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.reviewRunId}, 0))`,
    );
    const [run] = await transaction
      .select({
        id: reviewRuns.id,
        status: reviewRuns.status,
        organizationId: reviewRuns.organizationId,
        ownerUserId: reviewRuns.ownerUserId,
        workflowRunId: reviewRuns.workflowRunId,
      })
      .from(reviewRuns)
      .where(
        and(
          eq(reviewRuns.id, input.reviewRunId),
          eq(reviewRuns.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!run) return { run: undefined, changed: false };
    if (run.status !== "queued" && run.status !== "running") return { run, changed: false };

    const [cancelled] = await transaction
      .update(reviewRuns)
      .set({
        status: "cancelled",
        failureCode: "REVIEW_CANCELLED",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(reviewRuns.id, run.id), inArray(reviewRuns.status, ["queued", "running"])))
      .returning({ id: reviewRuns.id });
    if (!cancelled) return { run, changed: false };

    await appendAuditEvent(transaction, {
      organizationId: run.organizationId,
      actorUserId: actor.userId,
      action: "review.cancelled",
      targetType: "review_run",
      targetId: run.id,
      metadata: { previousStatus: run.status },
    });
    return { run, changed: true };
  });

  if (!result.run) return { ok: false, code: "REVIEW_RUN_NOT_FOUND" };
  if (result.changed) {
    await closeOpenCells({
      reviewRunId: result.run.id,
      state: "abandoned",
      failureCode: "REVIEW_CANCELLED",
    });
    for (const purpose of ["review_routing", "review_escalation"] as const) {
      await deleteTemporaryCredentialsForBinding({
        purpose,
        bindingId: result.run.id,
        ownerUserId: result.run.ownerUserId,
      });
    }
    await cancelReviewChildren(result.run.id);
    if (result.run.workflowRunId) {
      // Nur beschleunigend: auch ohne Abbruch endet der Workflow am Status.
      await getRun(result.run.workflowRunId)
        .cancel()
        .catch((error: unknown) => {
          console.error(
            "[review-cancel] workflow run could not be cancelled",
            error instanceof Error ? error.name : typeof error,
          );
        });
    }
  }
  return {
    ok: true,
    status: result.changed ? "cancelled" : result.run.status,
    changed: result.changed,
  };
}
