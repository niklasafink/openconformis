import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  disclosureBlockContext,
  disclosureCaseDocuments,
  disclosureFigures,
  disclosureStatements,
} from "@/server/db/schema/disclosure";

import { startRecognition } from "./manage-case";

/** Kontext eines Blocks für die Dokumentansicht (serialisierbar). */
export type ViewBlockContext = {
  page: number | null;
  tz: string | null;
  technical: boolean;
  table: { index: number; row: number; column: number; header: boolean } | null;
  rowLabel: string | null;
  columnLabel: string | null;
  caption: string | null;
};

export type ViewFigure = {
  id: string;
  blockId: string;
  start: number;
  end: number;
  raw: string;
  /** Exakter Wert als Dezimalstring in Millionstel; `null` bei unlesbarem Format. */
  valueMicro: string | null;
  unit: "EUR" | "percent" | "count" | "unknown";
  scale: number;
  decimals: number;
  period: "current" | "prior" | "other" | null;
  issue: string | null;
};

export type ViewStatement = {
  id: string;
  blockId: string;
  start: number;
  end: number;
  raw: string;
  direction: "up" | "down" | "flat";
};

/**
 * Alles, was der Plausicheck vor einem Lauf zeigt: Erkennungsstand, Blockkontext,
 * erkannte Zahlen und Richtungswörter des Berichts. Startet eine hängengebliebene
 * Erkennung erneut.
 */
export async function readRecognition(caseDocumentId: string) {
  const [document] = await db
    .select({
      status: disclosureCaseDocuments.recognitionStatus,
      workflowRunId: disclosureCaseDocuments.recognitionWorkflowRunId,
      errorCode: disclosureCaseDocuments.recognitionErrorCode,
      reportYear: disclosureCaseDocuments.reportYear,
      tableStructure: disclosureCaseDocuments.tableStructure,
      createdAt: disclosureCaseDocuments.createdAt,
    })
    .from(disclosureCaseDocuments)
    .where(eq(disclosureCaseDocuments.id, caseDocumentId))
    .limit(1);
  if (!document) return undefined;
  if (
    document.status === "pending" &&
    !document.workflowRunId &&
    Date.now() - document.createdAt.getTime() > 30_000
  ) {
    await startRecognition(caseDocumentId);
  }
  if (document.status !== "ready") {
    return {
      status: document.status,
      errorCode: document.errorCode,
      contexts: {},
      figures: [],
      statements: [],
      tableStructure: false,
    };
  }

  const [contexts, figures, statements] = await Promise.all([
    db
      .select()
      .from(disclosureBlockContext)
      .where(eq(disclosureBlockContext.caseDocumentId, caseDocumentId)),
    db
      .select()
      .from(disclosureFigures)
      .where(eq(disclosureFigures.caseDocumentId, caseDocumentId))
      .orderBy(asc(disclosureFigures.documentBlockId), asc(disclosureFigures.startOffset)),
    db
      .select()
      .from(disclosureStatements)
      .where(eq(disclosureStatements.caseDocumentId, caseDocumentId))
      .orderBy(asc(disclosureStatements.documentBlockId), asc(disclosureStatements.startOffset)),
  ]);

  return {
    status: document.status,
    errorCode: null,
    tableStructure: document.tableStructure,
    contexts: Object.fromEntries(
      contexts.map((context): [string, ViewBlockContext] => [
        context.documentBlockId,
        {
          page: context.pageNumber,
          tz: context.tz,
          technical: context.technical,
          table:
            context.tableIndex === null
              ? null
              : {
                  index: context.tableIndex,
                  row: context.rowIndex ?? 0,
                  column: context.columnIndex ?? 0,
                  header: context.isHeader,
                },
          rowLabel: context.rowLabel,
          columnLabel: context.columnLabel,
          caption: context.tableCaption,
        },
      ]),
    ),
    figures: figures.map((figure): ViewFigure => ({
      id: figure.id,
      blockId: figure.documentBlockId,
      start: figure.startOffset,
      end: figure.endOffset,
      raw: figure.rawText,
      valueMicro: figure.valueMicro === null ? null : figure.valueMicro.toString(),
      unit: figure.unit,
      scale: figure.scale,
      decimals: figure.decimals,
      period: figure.periodHint,
      issue: figure.parseIssue,
    })),
    statements: statements.map((statement): ViewStatement => ({
      id: statement.id,
      blockId: statement.documentBlockId,
      start: statement.startOffset,
      end: statement.endOffset,
      raw: statement.rawText,
      direction: statement.direction,
    })),
  };
}
