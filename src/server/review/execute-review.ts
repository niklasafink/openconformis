import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNotNull, isNull, like, lt, or, sql } from "drizzle-orm";
import { getRun } from "workflow/api";

import { appendAuditEvent } from "@/server/audit/event";
import { deleteTemporaryCredentialsForBinding } from "@/server/ai/credential-cleanup";
import { db } from "@/server/db/client";
import { reviewCells, reviewRunDocuments, reviewRuns } from "@/server/db/schema/reviews";

import { closeOpenCells, openCellStates } from "./review-cells";
import { isReviewRunLive, loadReviewRun } from "./review-loaders";

/**
 * Der Eltern-Lauf. Er startet je Vertrag einen **eigenen** Kind-Lauf, wartet dauerhaft
 * und gleicht ab — er rechnet nichts selbst. Bewusst kein `await` auf einen
 * Kind-Workflow: das flachte ihn in den Eltern-Lauf ein, dessen Ereignisprotokoll bei
 * mehreren tausend Schritten unbrauchbar würde.
 */

/** Verträge, die gleichzeitig laufen. Die Drosselung je Kind (2 Req/s) rechnet damit. */
export const reviewDocumentConcurrency = 8;
/** Höchster Anteil scheiternder Zellen, bei dem der Lauf noch als Ergebnis mit Lücken gilt. */
export const maximumGapShare = 0.2;
/** So lange darf eine Vorläufer-Markierung ohne Kind-Lauf stehen, bevor sie freigegeben wird. */
const staleClaimMilliseconds = 2 * 60_000;

async function deleteRunCredentials(run: { id: string; ownerUserId: string }) {
  // Nur hier und im Abbruch — nie im Kind. Räumte ein Kind auf, zöge das erste fertige
  // Kind den anderen neunundvierzig den Schlüssel weg.
  for (const purpose of ["review_routing", "review_escalation"] as const) {
    await deleteTemporaryCredentialsForBinding({
      purpose,
      bindingId: run.id,
      ownerUserId: run.ownerUserId,
    });
  }
}

export type PrepareReviewResult =
  | { status: "running" }
  | { status: "duplicate" | "completed" | "completed_with_gaps" | "failed" | "cancelled" };

export async function prepareReviewExecution(
  reviewRunId: string,
  workflowRunId: string,
): Promise<PrepareReviewResult> {
  const [claimed] = await db
    .update(reviewRuns)
    .set({ workflowRunId, updatedAt: new Date() })
    .where(
      and(
        eq(reviewRuns.id, reviewRunId),
        or(isNull(reviewRuns.workflowRunId), eq(reviewRuns.workflowRunId, workflowRunId)),
      ),
    )
    .returning({ id: reviewRuns.id });
  if (!claimed) return { status: "duplicate" };

  const run = await loadReviewRun(reviewRunId);
  if (!isReviewRunLive(run.status)) {
    await deleteRunCredentials(run);
    return {
      status: run.status as Exclude<PrepareReviewResult["status"], "running" | "duplicate">,
    };
  }

  await db
    .update(reviewRuns)
    .set({
      status: "running",
      stage: "routing",
      progressPercent: sql`greatest(${reviewRuns.progressPercent}, 10)`,
      startedAt: sql`coalesce(${reviewRuns.startedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(reviewRuns.id, reviewRunId), inArray(reviewRuns.status, ["queued", "running"])));
  return { status: "running" };
}

export type ClaimedDocument = { runDocumentId: string; claimToken: string };

/**
 * Belegt die nächsten Verträge, bevor `start()` läuft: ein bedingtes
 * `UPDATE … WHERE child_workflow_run_id IS NULL`. Zwei Wiederholungen dieses Schritts
 * können denselben Vertrag deshalb nicht beide starten.
 */
export async function claimNextReviewDocuments(reviewRunId: string): Promise<{
  state: "running" | "ended";
  claims: ClaimedDocument[];
  open: number;
  unstarted: number;
}> {
  const run = await loadReviewRun(reviewRunId);
  if (!isReviewRunLive(run.status)) return { state: "ended", claims: [], open: 0, unstarted: 0 };

  const counts = await countDocuments(reviewRunId);
  const capacity = Math.max(0, reviewDocumentConcurrency - counts.open);
  const candidates =
    capacity === 0
      ? []
      : await db
          .select({ id: reviewRunDocuments.id })
          .from(reviewRunDocuments)
          .where(
            and(
              eq(reviewRunDocuments.reviewRunId, reviewRunId),
              isNull(reviewRunDocuments.childWorkflowRunId),
              isNull(reviewRunDocuments.finishedAt),
            ),
          )
          .orderBy(asc(reviewRunDocuments.ordinal))
          .limit(capacity);

  const claims: ClaimedDocument[] = [];
  for (const candidate of candidates) {
    const claimToken = `claim:${randomUUID()}`;
    const [claimed] = await db
      .update(reviewRunDocuments)
      .set({ childWorkflowRunId: claimToken, updatedAt: new Date() })
      .where(
        and(eq(reviewRunDocuments.id, candidate.id), isNull(reviewRunDocuments.childWorkflowRunId)),
      )
      .returning({ id: reviewRunDocuments.id });
    if (claimed) claims.push({ runDocumentId: candidate.id, claimToken });
  }
  return {
    state: "running",
    claims,
    open: counts.open + claims.length,
    unstarted: counts.unstarted - claims.length,
  };
}

/** Schreibt die echte Lauf-ID zurück — sofern das Kind sie nicht schon selbst gesetzt hat. */
export async function recordChildRun(claim: ClaimedDocument, childRunId: string) {
  await db
    .update(reviewRunDocuments)
    .set({ childWorkflowRunId: childRunId, updatedAt: new Date() })
    .where(
      and(
        eq(reviewRunDocuments.id, claim.runDocumentId),
        eq(reviewRunDocuments.childWorkflowRunId, claim.claimToken),
      ),
    );
}

/** `start()` ist gescheitert: die Markierung wird freigegeben, der Vertrag startet neu. */
export async function releaseChildClaim(claim: ClaimedDocument) {
  await db
    .update(reviewRunDocuments)
    .set({ childWorkflowRunId: null, updatedAt: new Date() })
    .where(
      and(
        eq(reviewRunDocuments.id, claim.runDocumentId),
        eq(reviewRunDocuments.childWorkflowRunId, claim.claimToken),
      ),
    );
}

async function countDocuments(reviewRunId: string) {
  const [counts] = await db
    .select({
      open: sql<number>`count(*) filter (where ${reviewRunDocuments.childWorkflowRunId} is not null and ${reviewRunDocuments.finishedAt} is null)::integer`,
      unstarted: sql<number>`count(*) filter (where ${reviewRunDocuments.childWorkflowRunId} is null and ${reviewRunDocuments.finishedAt} is null)::integer`,
    })
    .from(reviewRunDocuments)
    .where(eq(reviewRunDocuments.reviewRunId, reviewRunId));
  return { open: counts?.open ?? 0, unstarted: counts?.unstarted ?? 0 };
}

/** Stoppt die laufenden Kind-Läufe eines Laufs. Beschleunigt nur: sie enden auch am Status. */
export async function cancelReviewChildren(reviewRunId: string) {
  const children = await db
    .select({ childWorkflowRunId: reviewRunDocuments.childWorkflowRunId })
    .from(reviewRunDocuments)
    .where(
      and(
        eq(reviewRunDocuments.reviewRunId, reviewRunId),
        isNotNull(reviewRunDocuments.childWorkflowRunId),
        isNull(reviewRunDocuments.finishedAt),
        sql`${reviewRunDocuments.childWorkflowRunId} not like 'claim:%'`,
      ),
    );
  await Promise.all(
    children.map(({ childWorkflowRunId }) =>
      getRun(childWorkflowRunId!)
        .cancel()
        .catch((error: unknown) => {
          console.error(
            "[review-cancel] child run could not be cancelled",
            error instanceof Error ? error.name : typeof error,
          );
        }),
    ),
  );
  return children.length;
}

export type ReconcileReviewResult = {
  state: "running" | "cancelled" | "deadline_exceeded" | "ended";
  open: number;
  unstarted: number;
};

const terminalChildStatuses = new Set(["completed", "failed", "cancelled"]);

/**
 * Gleicht den Eltern-Lauf mit dem ab, was die Kinder wirklich tun — der Wachhund für
 * hart gestorbene Kinder, den der 20-Sekunden-Schlaf antreibt.
 */
export async function reconcileReviewDocuments(
  reviewRunId: string,
): Promise<ReconcileReviewResult> {
  const run = await loadReviewRun(reviewRunId);
  if (run.status === "cancelled") {
    await cancelReviewChildren(reviewRunId);
    await closeOpenCells({ reviewRunId, state: "abandoned", failureCode: "REVIEW_CANCELLED" });
    return { state: "cancelled", open: 0, unstarted: 0 };
  }
  if (!isReviewRunLive(run.status)) return { state: "ended", open: 0, unstarted: 0 };

  // Stufe drei: hat der Schlüssel seine Frist erreicht, endet der Lauf, statt endlos
  // zu wiederholen. Fertige Zellen bleiben.
  if (run.credentialDeadlineAt && run.credentialDeadlineAt.getTime() <= Date.now()) {
    await cancelReviewChildren(reviewRunId);
    await closeOpenCells({
      reviewRunId,
      state: "abandoned",
      failureCode: "REVIEW_DEADLINE_EXCEEDED",
    });
    await db
      .update(reviewRunDocuments)
      .set({
        finishedAt: sql`coalesce(${reviewRunDocuments.finishedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(eq(reviewRunDocuments.reviewRunId, reviewRunId));
    return { state: "deadline_exceeded", open: 0, unstarted: 0 };
  }

  // Eine Markierung ohne Kind-Lauf: `start()` ist nach dem Belegen gestorben.
  await db
    .update(reviewRunDocuments)
    .set({ childWorkflowRunId: null, updatedAt: new Date() })
    .where(
      and(
        eq(reviewRunDocuments.reviewRunId, reviewRunId),
        like(reviewRunDocuments.childWorkflowRunId, "claim:%"),
        isNull(reviewRunDocuments.startedAt),
        lt(reviewRunDocuments.updatedAt, new Date(Date.now() - staleClaimMilliseconds)),
      ),
    );

  const running = await db
    .select({
      id: reviewRunDocuments.id,
      childWorkflowRunId: reviewRunDocuments.childWorkflowRunId,
    })
    .from(reviewRunDocuments)
    .where(
      and(
        eq(reviewRunDocuments.reviewRunId, reviewRunId),
        isNotNull(reviewRunDocuments.childWorkflowRunId),
        // Auch ein Kind, das nie angelaufen ist (`started_at` leer), zählt: sonst bliebe
        // sein Vertrag bis zur Schlüsselfrist „offen".
        sql`${reviewRunDocuments.childWorkflowRunId} not like 'claim:%'`,
        isNull(reviewRunDocuments.finishedAt),
      ),
    );
  for (const document of running) {
    let status: string;
    try {
      status = await getRun(document.childWorkflowRunId!).status;
    } catch {
      // Ein Kind-Lauf, den die Laufzeit nicht mehr kennt, arbeitet nicht mehr.
      status = "failed";
    }
    if (!terminalChildStatuses.has(status)) continue;
    await closeOpenCells({
      reviewRunId,
      runDocumentId: document.id,
      state: "abandoned",
      failureCode: `CHILD_RUN_${status.toUpperCase()}`,
    });
    await db
      .update(reviewRunDocuments)
      .set({
        finishedAt: sql`coalesce(${reviewRunDocuments.finishedAt}, now())`,
        failureCode: sql`coalesce(${reviewRunDocuments.failureCode}, ${`CHILD_RUN_${status.toUpperCase()}`})`,
        updatedAt: new Date(),
      })
      .where(eq(reviewRunDocuments.id, document.id));
  }

  const counts = await countDocuments(reviewRunId);
  return { state: "running", ...counts };
}

export type FinalizeReviewResult = {
  reviewRunId: string;
  status: "completed" | "completed_with_gaps" | "failed" | "cancelled";
};

/**
 * Der Abschluss. Er verlangt **keine** Vollständigkeit: bei tausend Zellen dürfte eine
 * einzige dauerhaft scheiternde nicht 999 gute Antworten verwerfen. Gewartet wird nur
 * auf offene Zellen; `failed` und `abandoned` sind terminal.
 */
export async function finalizeReviewExecution(reviewRunId: string): Promise<FinalizeReviewResult> {
  const run = await loadReviewRun(reviewRunId);
  if (run.status === "cancelled") {
    await deleteRunCredentials(run);
    return { reviewRunId, status: "cancelled" };
  }
  if (
    run.status === "completed" ||
    run.status === "completed_with_gaps" ||
    run.status === "failed"
  ) {
    await deleteRunCredentials(run);
    return { reviewRunId, status: run.status };
  }

  // Was jetzt noch offen ist, hätte längst enden müssen; es endet sichtbar als Lücke.
  await closeOpenCells({ reviewRunId, state: "abandoned", failureCode: "REVIEW_NOT_FINISHED" });

  const result = await db.transaction(async (transaction) => {
    const [counts] = await transaction
      .select({
        total: sql<number>`count(*)::integer`,
        gaps: sql<number>`count(*) filter (where ${reviewCells.state} in ('failed', 'abandoned'))::integer`,
        open: sql<number>`count(*) filter (where ${reviewCells.state} in (${sql.join(
          openCellStates.map((state) => sql`${state}`),
          sql`, `,
        )}))::integer`,
      })
      .from(reviewCells)
      .where(eq(reviewCells.reviewRunId, reviewRunId));
    const total = counts?.total ?? 0;
    const gaps = counts?.gaps ?? 0;
    const status: FinalizeReviewResult["status"] =
      gaps === 0
        ? "completed"
        : total > 0 && gaps / total <= maximumGapShare
          ? "completed_with_gaps"
          : "failed";

    const [updated] = await transaction
      .update(reviewRuns)
      .set({
        status,
        stage: "finalizing",
        progressPercent: 100,
        completedCellCount: total,
        failedCellCount: gaps,
        completedAt: new Date(),
        failureCode: status === "failed" ? "REVIEW_TOO_MANY_GAPS" : null,
        updatedAt: new Date(),
      })
      .where(and(eq(reviewRuns.id, reviewRunId), inArray(reviewRuns.status, ["queued", "running"])))
      .returning({ id: reviewRuns.id });
    if (updated) {
      await appendAuditEvent(transaction, {
        organizationId: run.organizationId,
        actorUserId: run.ownerUserId,
        action: `review.${status}`,
        targetType: "review_run",
        targetId: reviewRunId,
        metadata: { cellCount: total, gapCount: gaps, engine: run.decisionEngine },
      });
    }
    return status;
  });

  await deleteRunCredentials(run);
  return { reviewRunId, status: result };
}

/** Alle Versuche verbraucht oder ein dauerhafter Fehler: der Lauf endet als fehlgeschlagen. */
export async function failReviewExecution(
  reviewRunId: string,
  failure: { failureCode?: string; failureDetail?: string } = {},
) {
  const run = await loadReviewRun(reviewRunId);
  if (isReviewRunLive(run.status)) {
    await cancelReviewChildren(reviewRunId);
    await closeOpenCells({
      reviewRunId,
      state: "abandoned",
      failureCode: failure.failureCode ?? "REVIEW_RETRIES_EXHAUSTED",
    });
    await db.transaction(async (transaction) => {
      const [failed] = await transaction
        .update(reviewRuns)
        .set({
          status: "failed",
          failureCode: failure.failureCode ?? "REVIEW_RETRIES_EXHAUSTED",
          failureDetail: failure.failureDetail ?? null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(reviewRuns.id, reviewRunId), inArray(reviewRuns.status, ["queued", "running"])),
        )
        .returning({ id: reviewRuns.id });
      if (failed) {
        await appendAuditEvent(transaction, {
          organizationId: run.organizationId,
          actorUserId: run.ownerUserId,
          action: "review.failed",
          targetType: "review_run",
          targetId: reviewRunId,
          metadata: { failureCode: failure.failureCode ?? "REVIEW_RETRIES_EXHAUSTED" },
        });
      }
    });
  }
  await deleteRunCredentials(run);
  return { reviewRunId, status: "failed" as const };
}
