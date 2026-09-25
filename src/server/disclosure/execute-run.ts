import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { renderComment, renderFindingTitle } from "@/domain/disclosure/checks/comments";
import { deriveFindings } from "@/domain/disclosure/checks/findings";
import { runDeterministicChecks } from "@/domain/disclosure/checks/run";
import type { CheckDraft } from "@/domain/disclosure/checks/types";
import { appendAuditEvent } from "@/server/audit/event";
import { deleteTemporaryCredentialsForBinding } from "@/server/ai/credential-cleanup";
import { db } from "@/server/db/client";
import {
  disclosureBlockContext,
  disclosureCaseDocuments,
  disclosureChecks,
  disclosureFigures,
  disclosureFindings,
  disclosureRuns,
  disclosureStatements,
} from "@/server/db/schema/disclosure";

import { loadEngineDocument } from "./engine-document";
import { loadEvidenceInputs } from "./evidence";
import { disclosureJevActive } from "./jev-route";

/**
 * Ausführung eines Plausicheck-Laufs in Workflow-Schritten. Jeder Schritt liest den
 * eingefrorenen Lauf und ist wiederholbar: Prüfungen werden über ihren eindeutigen
 * Schlüssel eingefügt, Feststellungen über `(run_id, check_id)`.
 */

function isLive(status: string) {
  return status === "queued" || status === "running";
}

async function loadRun(runId: string) {
  const [run] = await db.select().from(disclosureRuns).where(eq(disclosureRuns.id, runId)).limit(1);
  if (!run) throw new Error("DISCLOSURE_RUN_NOT_FOUND");
  return run;
}

/**
 * Löscht die kurzlebigen Schlüssel eines Laufs — Modell und Jev — im Abschluss, im
 * Fehlerpfad und beim Stoppen. Ein Lauf ohne Modellroute hat keinen.
 */
export async function deleteDisclosureRunCredentials(run: {
  id: string;
  ownerUserId: string;
  routeProvider: string | null;
  assistCredentialId?: string | null;
}) {
  if (!run.routeProvider && !run.assistCredentialId) return;
  const purposes = [
    ...(run.routeProvider ? (["disclosure"] as const) : []),
    ...(run.assistCredentialId ? (["disclosure_assist"] as const) : []),
  ];
  for (const purpose of purposes) {
    await deleteTemporaryCredentialsForBinding({
      purpose,
      bindingId: run.id,
      ownerUserId: run.ownerUserId,
    });
  }
}

export type PrepareDisclosureResult =
  | { status: "running"; model: boolean; jev: boolean }
  | { status: "duplicate" | "completed" | "completed_with_gaps" | "failed" | "cancelled" };

/** Beansprucht den Lauf für genau einen Workflow; ein Duplikat endet still. */
export async function prepareDisclosureRun(
  runId: string,
  workflowRunId: string,
): Promise<PrepareDisclosureResult> {
  const [claimed] = await db
    .update(disclosureRuns)
    .set({ workflowRunId, updatedAt: new Date() })
    .where(
      and(
        eq(disclosureRuns.id, runId),
        or(isNull(disclosureRuns.workflowRunId), eq(disclosureRuns.workflowRunId, workflowRunId)),
      ),
    )
    .returning({ id: disclosureRuns.id });
  if (!claimed) return { status: "duplicate" };
  const run = await loadRun(runId);
  if (!isLive(run.status)) {
    await deleteDisclosureRunCredentials(run);
    return {
      status: run.status as Exclude<PrepareDisclosureResult["status"], "running" | "duplicate">,
    };
  }
  await db
    .update(disclosureRuns)
    .set({
      status: "running",
      stage: "checks",
      startedAt: sql`coalesce(${disclosureRuns.startedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(disclosureRuns.id, runId), inArray(disclosureRuns.status, ["queued", "running"])),
    );
  return {
    status: "running",
    model: run.routeProvider !== null,
    jev: run.routeProvider !== null && disclosureJevActive(run),
  };
}

function rowOf(runId: string, draft: CheckDraft): typeof disclosureChecks.$inferInsert {
  return {
    runId,
    kind: draft.kind,
    status: draft.status,
    subjectKey: draft.subjectFigureId ?? draft.subjectStatementId!,
    subjectFigureId: draft.subjectFigureId,
    statementId: draft.subjectStatementId,
    actualMicro: draft.actual,
    expectedMicro: draft.expected,
    toleranceMicro: draft.tolerance,
    rounded: draft.rounded,
    sourceKind: draft.sourceKind,
    sourceFigureIds: draft.sourceFigureIds,
    sourceBlockIds: draft.sourceBlockIds,
    sourceAccountIds: draft.sourceAccountIds ?? [],
    sourceLabel: draft.sourceLabel.slice(0, 300),
    subjectLabel: draft.subjectLabel?.slice(0, 200) ?? null,
    commentCode: draft.comment.code,
    commentParams: { ...draft.comment.params },
    comment: renderComment(draft.comment, "de"),
    sourceKey: draft.sourceKey.slice(0, 500),
    assignmentSource: draft.assignment,
    confidenceBp: draft.confidenceBp,
  };
}

/** Speichert Prüfungen; eine Wiederholung überspringt vorhandene. */
export async function storeChecks(runId: string, drafts: readonly CheckDraft[]) {
  const rows = drafts
    .filter((draft) => draft.subjectFigureId || draft.subjectStatementId)
    .map((draft) => rowOf(runId, draft));
  for (let index = 0; index < rows.length; index += 250) {
    await db
      .insert(disclosureChecks)
      .values(rows.slice(index, index + 250))
      .onConflictDoNothing({
        target: [
          disclosureChecks.runId,
          disclosureChecks.kind,
          disclosureChecks.subjectKey,
          disclosureChecks.sourceKey,
        ],
      });
  }
  return rows.length;
}

/**
 * Die deterministischen Prüfungen. Sie laufen gegen die eingefrorene Erkennung; hat
 * sich die Erkennung seit dem Start geändert, endet der Lauf mit einem Fehler statt mit
 * Prüfungen gegen andere Zahlen.
 */
export async function runDeterministicStage(runId: string) {
  const run = await loadRun(runId);
  if (run.status !== "running") return { state: "ended" as const, pending: 0 };
  const [document] = await db
    .select({ version: disclosureCaseDocuments.recognitionVersion })
    .from(disclosureCaseDocuments)
    .where(eq(disclosureCaseDocuments.id, run.reportCaseDocumentId))
    .limit(1);
  if (document?.version !== run.extractionVersion)
    throw new Error("DISCLOSURE_RECOGNITION_CHANGED");
  const engineDocument = await loadEngineDocument(run.reportCaseDocumentId);
  if (!engineDocument) throw new Error("DISCLOSURE_REPORT_MISSING");
  const evidence = await loadEvidenceInputs(run.evidenceFileIds);
  const { drafts, pending } = runDeterministicChecks(engineDocument, evidence);
  await storeChecks(runId, drafts);
  const planned = drafts.length + (run.routeProvider ? pending.length : 0);
  await db
    .update(disclosureRuns)
    .set({
      figureCount: engineDocument.figures.length,
      plannedCheckCount: sql`greatest(coalesce(${disclosureRuns.plannedCheckCount}, 0), ${planned})`,
      stage: run.routeProvider && pending.length > 0 ? "assignment" : "finalize",
      updatedAt: new Date(),
    })
    .where(eq(disclosureRuns.id, runId));
  return { state: "running" as const, pending: run.routeProvider ? pending.length : 0 };
}

/**
 * Feststellungen aus den gespeicherten Prüfungen: je roter oder oranger Marke eine, in
 * Dokumentreihenfolge. Idempotent über `(run_id, check_id)`; auch nach einem Abbruch, damit
 * die gespeicherten Prüfungen sichtbar bleiben.
 */
export async function materializeFindings(runId: string) {
  const checks = await db
    .select({
      id: disclosureChecks.id,
      kind: disclosureChecks.kind,
      status: disclosureChecks.status,
      subjectFigureId: disclosureChecks.subjectFigureId,
      subjectStatementId: disclosureChecks.statementId,
      commentCode: disclosureChecks.commentCode,
      commentParams: disclosureChecks.commentParams,
      subjectLabel: disclosureChecks.subjectLabel,
    })
    .from(disclosureChecks)
    .where(eq(disclosureChecks.runId, runId))
    .orderBy(asc(disclosureChecks.createdAt), asc(disclosureChecks.id));
  const existing = await db
    .select({ id: disclosureFindings.id })
    .from(disclosureFindings)
    .where(eq(disclosureFindings.runId, runId))
    .limit(1);
  if (existing.length > 0) return;

  const run = await loadRun(runId);
  const figureIds = checks.flatMap((check) =>
    check.subjectFigureId ? [check.subjectFigureId] : [],
  );
  const statementIds = checks.flatMap((check) =>
    check.subjectStatementId ? [check.subjectStatementId] : [],
  );
  const [figurePositions, statementPositions] = await Promise.all([
    figureIds.length === 0
      ? []
      : db
          .select({
            id: disclosureFigures.id,
            start: disclosureFigures.startOffset,
            blockId: disclosureFigures.documentBlockId,
          })
          .from(disclosureFigures)
          .where(inArray(disclosureFigures.id, [...new Set(figureIds)])),
    statementIds.length === 0
      ? []
      : db
          .select({
            id: disclosureStatements.id,
            start: disclosureStatements.startOffset,
            blockId: disclosureStatements.documentBlockId,
          })
          .from(disclosureStatements)
          .where(inArray(disclosureStatements.id, [...new Set(statementIds)])),
  ]);
  const positions = [...figurePositions, ...statementPositions];
  const blockIds = [...new Set(positions.map((position) => position.blockId))];
  const contexts =
    blockIds.length === 0
      ? []
      : await db
          .select({
            blockId: disclosureBlockContext.documentBlockId,
            page: disclosureBlockContext.pageNumber,
            tz: disclosureBlockContext.tz,
            ordinal: sql<number>`(select ordinal from document_blocks where id = ${disclosureBlockContext.documentBlockId})`,
          })
          .from(disclosureBlockContext)
          .where(
            and(
              eq(disclosureBlockContext.caseDocumentId, run.reportCaseDocumentId),
              inArray(disclosureBlockContext.documentBlockId, blockIds),
            ),
          );
  const contextByBlock = new Map(contexts.map((context) => [context.blockId, context]));
  const positionById = new Map(positions.map((position) => [position.id, position]));
  const order = (subject: string) => {
    const position = positionById.get(subject);
    const context = position ? contextByBlock.get(position.blockId) : undefined;
    return (context?.ordinal ?? 0) * 100_000 + (position?.start ?? 0);
  };
  const findings = deriveFindings(
    checks.map((check) => ({
      ...check,
      comment: { code: check.commentCode as never, params: check.commentParams },
    })),
    order,
  );
  if (findings.length === 0) return;
  const rows = findings.map(({ subject, check, ordinal }) => {
    const position = positionById.get(subject);
    const context = position ? contextByBlock.get(position.blockId) : undefined;
    return {
      runId,
      checkId: check.id,
      ordinal,
      title: renderFindingTitle(check.comment, check.subjectLabel, "de"),
      severity: check.status,
      pageNumber: context?.page ?? null,
      tz: context?.tz ?? null,
    };
  });
  for (let index = 0; index < rows.length; index += 250) {
    await db
      .insert(disclosureFindings)
      .values(rows.slice(index, index + 250))
      .onConflictDoNothing({ target: [disclosureFindings.runId, disclosureFindings.checkId] });
  }
}

async function countOutcome(runId: string) {
  const [counts] = await db
    .select({
      mismatch: sql<number>`count(*) filter (where ${disclosureFindings.severity} = 'mismatch')::integer`,
      uncertain: sql<number>`count(*) filter (where ${disclosureFindings.severity} = 'uncertain')::integer`,
    })
    .from(disclosureFindings)
    .where(eq(disclosureFindings.runId, runId));
  return { mismatch: counts?.mismatch ?? 0, uncertain: counts?.uncertain ?? 0 };
}

/** Abschluss: Feststellungen, Zähler, Status und Löschung der Schlüssel. */
export async function finalizeDisclosureRun(runId: string) {
  const run = await loadRun(runId);
  if (run.status !== "running") {
    await deleteDisclosureRunCredentials(run);
    return { status: run.status };
  }
  await materializeFindings(runId);
  const counts = await countOutcome(runId);
  const status = run.failedBatchCount > 0 ? "completed_with_gaps" : "completed";
  const [finished] = await db
    .update(disclosureRuns)
    .set({
      status,
      stage: "done",
      mismatchCount: counts.mismatch,
      uncertainCount: counts.uncertain,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(disclosureRuns.id, runId), eq(disclosureRuns.status, "running")))
    .returning({ id: disclosureRuns.id });
  await deleteDisclosureRunCredentials(run);
  if (finished) {
    await appendAuditEvent(db, {
      organizationId: run.organizationId,
      actorUserId: run.ownerUserId,
      action: "disclosure.run_completed",
      targetType: "disclosure_run",
      targetId: runId,
      metadata: { status, mismatchCount: counts.mismatch, uncertainCount: counts.uncertain },
    });
  }
  return { status };
}

/** Fehlerpfad: der Lauf endet mit Ursache, gespeicherte Prüfungen bleiben, Schlüssel gehen. */
export async function failDisclosureRun(runId: string, failure: { code: string; detail?: string }) {
  const run = await loadRun(runId);
  await db
    .update(disclosureRuns)
    .set({
      status: "failed",
      stage: "done",
      failureCode: failure.code.slice(0, 80),
      failureDetail: failure.detail?.slice(0, 700) ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(disclosureRuns.id, runId), inArray(disclosureRuns.status, ["queued", "running"])),
    );
  await materializeFindings(runId).catch(() => undefined);
  await deleteDisclosureRunCredentials(run);
}
