import "server-only";

import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";

import { reviewReasonOf, type EscalationReason } from "@/domain/review/escalation";
import { db } from "@/server/db/client";
import { documentBlocks, policyVersions } from "@/server/db/schema/documents";
import {
  reviewCellEvidence,
  reviewCellOverrides,
  reviewCells,
  reviewColumns,
  reviewDocuments,
  reviewEvidencePackets,
  reviewRunColumns,
  reviewRunDocuments,
  reviewRuns,
  reviewTables,
} from "@/server/db/schema/reviews";

import type { ReviewExportData } from "@/server/exports/review-xlsx";

import { resolveReviewActor } from "./review-actor";

/**
 * Lesen für das Live-Raster ohne Datenbankflut. `router.refresh()` renderte bei
 * tausend Zellen die ganze Serverkomponente neu; stattdessen gibt es zwei schmale
 * Abfragen:
 *
 * - der **Kopf** (`getReviewRunHead`): eine Zeile mit Status, Fortschritt und
 *   `headSeq`, dem grössten `changeSeq` — der Taktgeber;
 * - das **Delta** (`getReviewCellDelta`): nur Zellen mit `changeSeq > since`, getragen
 *   vom Index `(review_run_id, change_seq)`. Es enthält aktualisierte Zellen ebenso
 *   wie neue, weil jede Mutation `changeSeq` weiterdreht.
 *
 * Begründung und Belegtext gehören **nicht** in die Zeilen des Deltas: sie holt erst
 * das Aufklappen einer Zelle über `getReviewCellDetail`.
 */

/**
 * Sicherheitsfenster. `bigserial` ist nur bei der *Vergabe* monoton, nicht beim
 * *Commit*: eine Zeile mit kleinerer Nummer kann später sichtbar werden. Der Server
 * liefert deshalb `nextSince = maxSeq - 50`; doppelte Lieferungen verwirft der Client
 * über `revision`.
 */
export const deltaSafetyWindow = 50;
export const defaultDeltaLimit = 300;
export const maximumDeltaLimit = 500;

async function ownedRun(reviewRunId: string) {
  const actor = await resolveReviewActor();
  const [run] = await db
    .select()
    .from(reviewRuns)
    .where(and(eq(reviewRuns.id, reviewRunId), eq(reviewRuns.organizationId, actor.organizationId)))
    .limit(1);
  return { actor, run };
}

export type ReviewRunHead = {
  id: string;
  reviewTableId: string;
  status: string;
  stage: string;
  progressPercent: number;
  totalCellCount: number;
  completedCellCount: number;
  escalatedCellCount: number;
  failedCellCount: number;
  escalationBudgetCells: number;
  decisionEngine: "jev" | "model";
  providerModelId: string;
  failureCode: string | null;
  headSeq: number;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export async function getReviewRunHead(reviewRunId: string): Promise<ReviewRunHead | undefined> {
  const { run } = await ownedRun(reviewRunId);
  if (!run) return undefined;
  // Ein reiner Index-Scan auf `(review_run_id, change_seq)`.
  const [latest] = await db
    .select({ seq: reviewCells.changeSeq })
    .from(reviewCells)
    .where(eq(reviewCells.reviewRunId, run.id))
    .orderBy(desc(reviewCells.changeSeq))
    .limit(1);
  return {
    id: run.id,
    reviewTableId: run.reviewTableId,
    status: run.status,
    stage: run.stage,
    progressPercent: run.progressPercent,
    totalCellCount: run.totalCellCount,
    completedCellCount: run.completedCellCount,
    escalatedCellCount: run.escalatedCellCount,
    failedCellCount: run.failedCellCount,
    escalationBudgetCells: run.escalationBudgetCells,
    decisionEngine: run.decisionEngine,
    providerModelId: run.providerModelId,
    failureCode: run.failureCode,
    headSeq: latest?.seq ?? 0,
    updatedAt: run.updatedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

export type ReviewCellSummary = {
  id: string;
  runDocumentId: string;
  runColumnId: string;
  state: string;
  source: string | null;
  answerBoolean: boolean | null;
  answerChoice: string | null;
  answerScoreBp: number | null;
  probabilityBp: number | null;
  confidenceBp: number | null;
  citationVerdict: string | null;
  failureCode: string | null;
  /** Warum die Zelle „Prüfung nötig" ist; sonst `null`. */
  reviewReason: EscalationReason | null;
  confirmed: boolean;
  /** Ein Mensch hat die Antwort überschrieben; `override` trägt dann die wirksame. */
  override: {
    answerBoolean: boolean | null;
    answerChoice: string | null;
    answerScoreBp: number | null;
  } | null;
  revision: number;
  changeSeq: number;
};

export async function getReviewCellDelta(input: {
  reviewRunId: string;
  since: number;
  limit?: number;
}): Promise<
  | {
      cells: ReviewCellSummary[];
      nextSince: number;
      /** Es gibt mehr Zellen jenseits dieses Blocks — sofort erneut abrufen. */
      hasMore: boolean;
    }
  | undefined
> {
  const { run } = await ownedRun(input.reviewRunId);
  if (!run) return undefined;
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? defaultDeltaLimit), 100),
    maximumDeltaLimit,
  );
  const since = Math.max(0, Math.trunc(input.since));

  const rows = await db
    .select({
      id: reviewCells.id,
      runDocumentId: reviewCells.runDocumentId,
      runColumnId: reviewCells.runColumnId,
      state: reviewCells.state,
      source: reviewCells.source,
      answerBoolean: reviewCells.answerBoolean,
      answerChoice: reviewCells.answerChoice,
      answerScoreBp: reviewCells.answerScoreBp,
      probabilityBp: reviewCells.probabilityBp,
      confidenceBp: reviewCells.confidenceBp,
      citationVerdict: reviewCells.citationVerdict,
      failureCode: reviewCells.failureCode,
      confirmedAt: reviewCells.confirmedAt,
      revision: reviewCells.revision,
      changeSeq: reviewCells.changeSeq,
    })
    .from(reviewCells)
    .where(and(eq(reviewCells.reviewRunId, run.id), gt(reviewCells.changeSeq, since)))
    .orderBy(asc(reviewCells.changeSeq))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const overrides =
    page.length === 0
      ? []
      : await db
          .select({
            cellId: reviewCellOverrides.cellId,
            answerBoolean: reviewCellOverrides.answerBoolean,
            answerChoice: reviewCellOverrides.answerChoice,
            answerScoreBp: reviewCellOverrides.answerScoreBp,
          })
          .from(reviewCellOverrides)
          .where(
            inArray(
              reviewCellOverrides.cellId,
              page.map((row) => row.id),
            ),
          )
          .orderBy(desc(reviewCellOverrides.createdAt));
  const latestOverride = new Map<string, (typeof overrides)[number]>();
  for (const override of overrides) {
    if (!latestOverride.has(override.cellId)) latestOverride.set(override.cellId, override);
  }

  const cells: ReviewCellSummary[] = page.map(({ confirmedAt, ...row }) => {
    const override = latestOverride.get(row.id);
    return {
      ...row,
      reviewReason: reviewReasonOf({ ...row, escalationThresholdBp: run.escalationThresholdBp }),
      confirmed: confirmedAt !== null,
      override: override
        ? {
            answerBoolean: override.answerBoolean,
            answerChoice: override.answerChoice,
            answerScoreBp: override.answerScoreBp,
          }
        : null,
    };
  });

  const maxSeq = page.reduce((highest, row) => Math.max(highest, row.changeSeq), since);
  return {
    cells,
    nextSince: Math.max(since, maxSeq - deltaSafetyWindow),
    hasMore,
  };
}

export type ReviewCellDetail = {
  cell: ReviewCellSummary & {
    rationale: string | null;
    distribution: Record<string, number>;
    decisionModelId: string | null;
    confirmedByUserId: string | null;
    confirmedAt: string | null;
  };
  column: { label: string; columnType: string; criteria: unknown };
  document: { displayName: string; policyVersionId: string };
  evidence: Array<{
    citationOrder: number;
    support: string;
    exactQuote: string;
    documentBlockId: string;
    blockKey: string;
    pageNumber: number | null;
    paragraphNumber: number | null;
  }>;
  /** Warum die Belegliste leer ist, falls sie es ist — eine ausdrückliche Leermeldung. */
  evidenceEmptyReason: string | null;
  overrides: Array<{
    id: string;
    answerBoolean: boolean | null;
    answerChoice: string | null;
    answerScoreBp: number | null;
    reason: string;
    actorUserId: string | null;
    createdAt: string;
  }>;
};

export async function getReviewCellDetail(input: {
  reviewRunId: string;
  cellId: string;
}): Promise<ReviewCellDetail | undefined> {
  const { run } = await ownedRun(input.reviewRunId);
  if (!run) return undefined;

  const [row] = await db
    .select({
      cell: reviewCells,
      column: reviewRunColumns,
      document: reviewRunDocuments,
      packet: reviewEvidencePackets,
    })
    .from(reviewCells)
    .innerJoin(reviewRunColumns, eq(reviewRunColumns.id, reviewCells.runColumnId))
    .innerJoin(reviewRunDocuments, eq(reviewRunDocuments.id, reviewCells.runDocumentId))
    .leftJoin(reviewEvidencePackets, eq(reviewEvidencePackets.cellId, reviewCells.id))
    .where(and(eq(reviewCells.id, input.cellId), eq(reviewCells.reviewRunId, run.id)))
    .limit(1);
  if (!row) return undefined;

  const [evidence, overrides] = await Promise.all([
    db
      .select({
        citationOrder: reviewCellEvidence.citationOrder,
        support: reviewCellEvidence.support,
        exactQuote: reviewCellEvidence.exactQuote,
        documentBlockId: reviewCellEvidence.documentBlockId,
        blockKey: documentBlocks.blockKey,
        pageNumber: reviewCellEvidence.pageNumber,
        paragraphNumber: reviewCellEvidence.paragraphNumber,
      })
      .from(reviewCellEvidence)
      .innerJoin(documentBlocks, eq(documentBlocks.id, reviewCellEvidence.documentBlockId))
      .where(eq(reviewCellEvidence.cellId, row.cell.id))
      .orderBy(asc(reviewCellEvidence.citationOrder)),
    db
      .select()
      .from(reviewCellOverrides)
      .where(eq(reviewCellOverrides.cellId, row.cell.id))
      .orderBy(desc(reviewCellOverrides.createdAt)),
  ]);

  const cell = row.cell;
  const latest = overrides[0];
  return {
    cell: {
      id: cell.id,
      runDocumentId: cell.runDocumentId,
      runColumnId: cell.runColumnId,
      state: cell.state,
      source: cell.source,
      answerBoolean: cell.answerBoolean,
      answerChoice: cell.answerChoice,
      answerScoreBp: cell.answerScoreBp,
      probabilityBp: cell.probabilityBp,
      confidenceBp: cell.confidenceBp,
      citationVerdict: cell.citationVerdict,
      failureCode: cell.failureCode,
      reviewReason: reviewReasonOf({ ...cell, escalationThresholdBp: run.escalationThresholdBp }),
      confirmed: cell.confirmedAt !== null,
      override: latest
        ? {
            answerBoolean: latest.answerBoolean,
            answerChoice: latest.answerChoice,
            answerScoreBp: latest.answerScoreBp,
          }
        : null,
      revision: cell.revision,
      changeSeq: cell.changeSeq,
      rationale: cell.rationale,
      // Die Verteilung, damit die Oberfläche die Wahrscheinlichkeiten zeigen kann.
      distribution: cell.distribution,
      decisionModelId: cell.decisionModelId,
      confirmedByUserId: cell.confirmedByUserId,
      confirmedAt: cell.confirmedAt?.toISOString() ?? null,
    },
    column: {
      label: row.column.label,
      columnType: row.column.columnType,
      criteria: row.column.criteria,
    },
    document: {
      displayName: row.document.displayName,
      policyVersionId: row.document.policyVersionId,
    },
    evidence,
    evidenceEmptyReason:
      evidence.length > 0
        ? null
        : (row.packet?.emptyReason ??
          (["complete", "needs_review"].includes(cell.state) ? "no_supporting_passage" : null)),
    overrides: overrides.map((override) => ({
      id: override.id,
      answerBoolean: override.answerBoolean,
      answerChoice: override.answerChoice,
      answerScoreBp: override.answerScoreBp,
      reason: override.reason,
      actorUserId: override.actorUserId,
      createdAt: override.createdAt.toISOString(),
    })),
  };
}

/** Zeilen und Spalten des Laufs für die Rasterstruktur; die Zellen kommen über das Delta. */
export async function getReviewRunGrid(reviewRunId: string) {
  const { run } = await ownedRun(reviewRunId);
  if (!run) return undefined;
  const [documents, columns] = await Promise.all([
    db
      .select({
        id: reviewRunDocuments.id,
        reviewDocumentId: reviewRunDocuments.reviewDocumentId,
        ordinal: reviewRunDocuments.ordinal,
        displayName: reviewRunDocuments.displayName,
        policyVersionId: reviewRunDocuments.policyVersionId,
        finishedAt: reviewRunDocuments.finishedAt,
        failureCode: reviewRunDocuments.failureCode,
      })
      .from(reviewRunDocuments)
      .where(eq(reviewRunDocuments.reviewRunId, run.id))
      .orderBy(asc(reviewRunDocuments.ordinal)),
    db
      .select({
        id: reviewRunColumns.id,
        reviewColumnId: reviewRunColumns.reviewColumnId,
        ordinal: reviewRunColumns.ordinal,
        label: reviewRunColumns.label,
        columnType: reviewRunColumns.columnType,
        criteria: reviewRunColumns.criteria,
      })
      .from(reviewRunColumns)
      .where(eq(reviewRunColumns.reviewRunId, run.id))
      .orderBy(asc(reviewRunColumns.ordinal)),
  ]);
  return { documents, columns };
}

/**
 * Die Textblöcke eines Vertrags im Lauf, für die Originalansicht der Zelle. Der Weg
 * über den Lauf statt über die Fassung prüft nebenbei die Zugehörigkeit zum
 * Arbeitsbereich.
 */
export async function getReviewDocumentBlocks(input: {
  reviewRunId: string;
  runDocumentId: string;
}) {
  const { run } = await ownedRun(input.reviewRunId);
  if (!run) return undefined;
  const [document] = await db
    .select({
      policyVersionId: reviewRunDocuments.policyVersionId,
      displayName: reviewRunDocuments.displayName,
      mimeType: policyVersions.detectedMimeType,
      declaredMimeType: policyVersions.declaredMimeType,
      originalDeletedAt: policyVersions.originalDeletedAt,
    })
    .from(reviewRunDocuments)
    .innerJoin(policyVersions, eq(policyVersions.id, reviewRunDocuments.policyVersionId))
    .where(
      and(
        eq(reviewRunDocuments.id, input.runDocumentId),
        eq(reviewRunDocuments.reviewRunId, run.id),
      ),
    )
    .limit(1);
  if (!document) return undefined;
  const blocks = await db
    .select({
      id: documentBlocks.id,
      blockKey: documentBlocks.blockKey,
      ordinal: documentBlocks.ordinal,
      blockType: documentBlocks.blockType,
      canonicalText: documentBlocks.canonicalText,
      headingPath: documentBlocks.headingPath,
      pageNumber: documentBlocks.pageNumber,
      paragraphNumber: documentBlocks.paragraphNumber,
    })
    .from(documentBlocks)
    .where(eq(documentBlocks.policyVersionId, document.policyVersionId))
    .orderBy(asc(documentBlocks.ordinal));
  return {
    policyVersionId: document.policyVersionId,
    displayName: document.displayName,
    mimeType: document.mimeType ?? document.declaredMimeType,
    originalDeleted: document.originalDeletedAt !== null,
    blocks,
  };
}

/** Die Prüfungen des Arbeitsbereichs, neueste zuerst. */
export async function listReviewTables() {
  const actor = await resolveReviewActor();
  return db
    .select({
      id: reviewTables.id,
      name: reviewTables.name,
      locale: reviewTables.locale,
      createdAt: reviewTables.createdAt,
      updatedAt: reviewTables.updatedAt,
    })
    .from(reviewTables)
    .where(
      and(eq(reviewTables.organizationId, actor.organizationId), isNull(reviewTables.archivedAt)),
    )
    .orderBy(desc(reviewTables.updatedAt))
    .limit(100);
}

/** Eine Prüfung mit ihren Spalten, Dokumenten und dem letzten Lauf. */
export async function getReviewTable(reviewTableId: string) {
  const actor = await resolveReviewActor();
  const [table] = await db
    .select()
    .from(reviewTables)
    .where(
      and(
        eq(reviewTables.id, reviewTableId),
        eq(reviewTables.organizationId, actor.organizationId),
        isNull(reviewTables.archivedAt),
      ),
    )
    .limit(1);
  if (!table) return undefined;
  const [columns, documents, [latestRun]] = await Promise.all([
    db
      .select()
      .from(reviewColumns)
      .where(and(eq(reviewColumns.reviewTableId, table.id), isNull(reviewColumns.archivedAt)))
      .orderBy(asc(reviewColumns.ordinal)),
    db
      .select({
        id: reviewDocuments.id,
        policyVersionId: reviewDocuments.policyVersionId,
        ordinal: reviewDocuments.ordinal,
        displayName: reviewDocuments.displayName,
        originalFilename: policyVersions.originalFilename,
        parseStatus: policyVersions.parseStatus,
        byteSize: policyVersions.byteSize,
        pageCount: policyVersions.pageCount,
        mimeType: policyVersions.detectedMimeType,
        declaredMimeType: policyVersions.declaredMimeType,
      })
      .from(reviewDocuments)
      .innerJoin(policyVersions, eq(policyVersions.id, reviewDocuments.policyVersionId))
      .where(eq(reviewDocuments.reviewTableId, table.id))
      .orderBy(asc(reviewDocuments.ordinal)),
    db
      .select({ id: reviewRuns.id, status: reviewRuns.status })
      .from(reviewRuns)
      .where(
        and(
          eq(reviewRuns.reviewTableId, table.id),
          table.resultsClearedAt ? gt(reviewRuns.createdAt, table.resultsClearedAt) : undefined,
        ),
      )
      .orderBy(desc(reviewRuns.createdAt))
      .limit(1),
  ]);
  return { table, columns, documents, latestRun: latestRun ?? null };
}

/** Alles, was der Rasterexport braucht — für Läufe, die nicht mehr arbeiten. */
export async function getOwnedReviewExportData(
  reviewRunId: string,
): Promise<ReviewExportData | undefined> {
  const { run } = await ownedRun(reviewRunId);
  if (!run) return undefined;
  const [table] = await db
    .select({ name: reviewTables.name, locale: reviewTables.locale })
    .from(reviewTables)
    .where(eq(reviewTables.id, run.reviewTableId))
    .limit(1);

  const [documents, columns, cells, evidence, overrides] = await Promise.all([
    db
      .select({ id: reviewRunDocuments.id, displayName: reviewRunDocuments.displayName })
      .from(reviewRunDocuments)
      .where(eq(reviewRunDocuments.reviewRunId, run.id))
      .orderBy(asc(reviewRunDocuments.ordinal)),
    db
      .select({
        id: reviewRunColumns.id,
        label: reviewRunColumns.label,
        columnType: reviewRunColumns.columnType,
        criteria: reviewRunColumns.criteria,
      })
      .from(reviewRunColumns)
      .where(eq(reviewRunColumns.reviewRunId, run.id))
      .orderBy(asc(reviewRunColumns.ordinal)),
    db.select().from(reviewCells).where(eq(reviewCells.reviewRunId, run.id)),
    db
      .select({
        cellId: reviewCellEvidence.cellId,
        citationOrder: reviewCellEvidence.citationOrder,
        support: reviewCellEvidence.support,
        exactQuote: reviewCellEvidence.exactQuote,
        pageNumber: reviewCellEvidence.pageNumber,
        paragraphNumber: reviewCellEvidence.paragraphNumber,
      })
      .from(reviewCellEvidence)
      .innerJoin(reviewCells, eq(reviewCells.id, reviewCellEvidence.cellId))
      .where(eq(reviewCells.reviewRunId, run.id))
      .orderBy(asc(reviewCellEvidence.citationOrder)),
    db
      .select({
        cellId: reviewCellOverrides.cellId,
        answerBoolean: reviewCellOverrides.answerBoolean,
        answerChoice: reviewCellOverrides.answerChoice,
        answerScoreBp: reviewCellOverrides.answerScoreBp,
        reason: reviewCellOverrides.reason,
      })
      .from(reviewCellOverrides)
      .innerJoin(reviewCells, eq(reviewCells.id, reviewCellOverrides.cellId))
      .where(eq(reviewCells.reviewRunId, run.id))
      .orderBy(desc(reviewCellOverrides.createdAt)),
  ]);

  const evidenceByCell = new Map<string, typeof evidence>();
  for (const row of evidence) {
    const list = evidenceByCell.get(row.cellId) ?? [];
    list.push(row);
    evidenceByCell.set(row.cellId, list);
  }
  const overrideByCell = new Map<string, (typeof overrides)[number]>();
  for (const row of overrides)
    if (!overrideByCell.has(row.cellId)) overrideByCell.set(row.cellId, row);

  return {
    id: run.id,
    name: table?.name ?? run.id,
    locale: table?.locale ?? "de",
    status: run.status,
    decisionEngine: run.decisionEngine,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    documents,
    columns,
    cells: cells.map((cell) => ({
      runDocumentId: cell.runDocumentId,
      runColumnId: cell.runColumnId,
      state: cell.state,
      source: cell.source,
      answerBoolean: cell.answerBoolean,
      answerChoice: cell.answerChoice,
      answerScoreBp: cell.answerScoreBp,
      probabilityBp: cell.probabilityBp,
      citationVerdict: cell.citationVerdict,
      failureCode: cell.failureCode,
      rationale: cell.rationale,
      confirmedAt: cell.confirmedAt,
      override: overrideByCell.get(cell.id) ?? null,
      evidence: evidenceByCell.get(cell.id) ?? [],
    })),
  };
}
