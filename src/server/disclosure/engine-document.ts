import "server-only";

import { asc, eq } from "drizzle-orm";

import type { EngineDocument } from "@/domain/disclosure/checks/types";
import { db } from "@/server/db/client";
import {
  disclosureBlockContext,
  disclosureCaseDocuments,
  disclosureFigures,
  disclosureStatements,
} from "@/server/db/schema/disclosure";
import { documentBlocks } from "@/server/db/schema/documents";

/**
 * Das Dokument, wie die Prüfungen es sehen: die unveränderlichen Blöcke eines Berichts
 * mit ihrem Kontext und die gespeicherten Zahlen und Richtungswörter. Die IDs sind die
 * der Datenbank, damit jede Prüfung auf eine gespeicherte Zahl verweist.
 */
export async function loadEngineDocument(caseDocumentId: string): Promise<EngineDocument | null> {
  const [document] = await db
    .select({
      policyVersionId: disclosureCaseDocuments.policyVersionId,
      reportYear: disclosureCaseDocuments.reportYear,
    })
    .from(disclosureCaseDocuments)
    .where(eq(disclosureCaseDocuments.id, caseDocumentId))
    .limit(1);
  if (!document?.policyVersionId) return null;

  const [blocks, contexts, figures, statements] = await Promise.all([
    db
      .select({
        id: documentBlocks.id,
        ordinal: documentBlocks.ordinal,
        blockType: documentBlocks.blockType,
        canonicalText: documentBlocks.canonicalText,
      })
      .from(documentBlocks)
      .where(eq(documentBlocks.policyVersionId, document.policyVersionId))
      .orderBy(asc(documentBlocks.ordinal)),
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
  const contextByBlock = new Map(contexts.map((context) => [context.documentBlockId, context]));
  return {
    reportYear: document.reportYear,
    blocks: blocks.map((block) => {
      const context = contextByBlock.get(block.id);
      return {
        id: block.id,
        ordinal: block.ordinal,
        type: block.blockType,
        text: block.canonicalText,
        page: context?.pageNumber ?? null,
        tz: context?.tz ?? null,
        technical: context?.technical ?? false,
        table:
          context && context.tableIndex !== null
            ? {
                index: context.tableIndex,
                row: context.rowIndex ?? 0,
                column: context.columnIndex ?? 0,
                header: context.isHeader,
                rowLabel: context.rowLabel,
                columnLabel: context.columnLabel,
                caption: context.tableCaption,
              }
            : null,
      };
    }),
    figures: figures.map((figure) => ({
      id: figure.id,
      blockId: figure.documentBlockId,
      start: figure.startOffset,
      end: figure.endOffset,
      raw: figure.rawText,
      micro: figure.valueMicro,
      displayUnit: figure.displayUnitMicro,
      unit: figure.unit,
      scale: figure.scale,
      decimals: figure.decimals,
      period: figure.periodHint,
      parenthesized: figure.parenthesized,
      issue: figure.parseIssue,
    })),
    statements: statements.flatMap((statement) =>
      statement.kind === "direction" && statement.direction
        ? [
            {
              id: statement.id,
              blockId: statement.documentBlockId,
              start: statement.startOffset,
              end: statement.endOffset,
              raw: statement.rawText,
              direction: statement.direction,
            },
          ]
        : [],
    ),
    years: statements.flatMap((statement) =>
      statement.kind === "year" && statement.year !== null
        ? [
            {
              id: statement.id,
              blockId: statement.documentBlockId,
              start: statement.startOffset,
              end: statement.endOffset,
              raw: statement.rawText,
              year: statement.year,
            },
          ]
        : [],
    ),
  };
}
