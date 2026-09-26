import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import mammoth from "mammoth";

import {
  deriveDocumentContext,
  type ContextInputBlock,
} from "@/domain/disclosure/document-context";
import { figureExtractionVersion, recognizeFigures } from "@/domain/disclosure/figures";
import { recognizeStatements, statementExtractionVersion } from "@/domain/disclosure/statements";
import { recognizeYears } from "@/domain/disclosure/years";
import { maximumPolicyBytes } from "@/domain/policies/upload";
import { locatedBlocksFromDocumentHtml } from "@/domain/policies/document-structure";
import { db } from "@/server/db/client";
import {
  disclosureBlockContext,
  disclosureCaseDocuments,
  disclosureFigures,
  disclosureStatements,
} from "@/server/db/schema/disclosure";
import { documentBlocks, policyVersions } from "@/server/db/schema/documents";
import { createPrivateObjectStore } from "@/server/storage/object-store";

export const recognitionVersion = `${figureExtractionVersion}+${statementExtractionVersion}`;

/** Dieselbe Umwandlung wie die Aufbereitung (`document-parser.ts`), damit die Reihenfolge stimmt. */
const ingestionStyleMap = [
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
];

type StoredBlock = { id: string; blockType: string; canonicalText: string; ordinal: number };

/**
 * Ordnet die Tabellenlage aus dem Original den gespeicherten Blöcken zu. Beide Folgen
 * entstehen aus demselben HTML; stimmt Art und Text einer Position überein, ist die
 * Lage sicher. Weicht die Folge ab, wird nichts geraten: die Blöcke bleiben ohne Lage.
 */
function alignCells(stored: readonly StoredBlock[], html: string) {
  const located = locatedBlocksFromDocumentHtml(html);
  const cells = new Map<string, NonNullable<(typeof located)[number]["cell"]>>();
  if (located.length !== stored.length) return { cells, aligned: false };
  for (let index = 0; index < stored.length; index += 1) {
    const block = stored[index]!;
    const candidate = located[index]!;
    if (candidate.kind !== block.blockType || candidate.text !== block.canonicalText) {
      return { cells: new Map(), aligned: false };
    }
    if (candidate.cell) cells.set(block.id, candidate.cell);
  }
  return { cells, aligned: true };
}

async function storedCells(caseDocumentId: string) {
  const rows = await db
    .select({
      documentBlockId: disclosureBlockContext.documentBlockId,
      table: disclosureBlockContext.tableIndex,
      row: disclosureBlockContext.rowIndex,
      column: disclosureBlockContext.columnIndex,
      header: disclosureBlockContext.isHeader,
    })
    .from(disclosureBlockContext)
    .where(
      and(
        eq(disclosureBlockContext.caseDocumentId, caseDocumentId),
        isNotNull(disclosureBlockContext.tableIndex),
      ),
    );
  const cells = new Map<string, NonNullable<ContextInputBlock["cell"]>>();
  for (const row of rows) {
    cells.set(row.documentBlockId, {
      table: row.table!,
      row: row.row ?? 0,
      column: row.column ?? 0,
      // Kopfzeilen des Originals; abgeleitete Kopfzeilen bestimmt die Ableitung ohnehin gleich.
      header: row.header,
    });
  }
  return cells;
}

async function readOriginalHtml(objectKey: string) {
  const bytes = await createPrivateObjectStore().getObjectBytes(objectKey, maximumPolicyBytes);
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    { styleMap: ingestionStyleMap },
  );
  return result.value;
}

/**
 * Erkennung eines Berichts: Kontext, Zahlen und Richtungswörter. Deterministisch und
 * ohne Modellaufruf; eine Wiederholung ersetzt das Ergebnis derselben Version.
 */
export async function recognizeCaseDocument(caseDocumentId: string, workflowRunId?: string) {
  const [claimed] = await db
    .update(disclosureCaseDocuments)
    .set({
      recognitionStatus: "running",
      recognitionWorkflowRunId: workflowRunId ?? null,
      recognitionErrorCode: null,
    })
    .where(
      and(
        eq(disclosureCaseDocuments.id, caseDocumentId),
        or(
          inArray(disclosureCaseDocuments.recognitionStatus, ["pending", "failed", "running"]),
          and(
            eq(disclosureCaseDocuments.recognitionStatus, "ready"),
            or(
              isNull(disclosureCaseDocuments.recognitionVersion),
              ne(disclosureCaseDocuments.recognitionVersion, recognitionVersion),
            ),
          ),
        ),
      ),
    )
    .returning({ policyVersionId: disclosureCaseDocuments.policyVersionId });
  if (!claimed?.policyVersionId) return { status: "skipped" as const };

  const [version] = await db
    .select({
      objectKey: policyVersions.objectKey,
      originalDeletedAt: policyVersions.originalDeletedAt,
    })
    .from(policyVersions)
    .where(eq(policyVersions.id, claimed.policyVersionId))
    .limit(1);
  const blocks = await db
    .select({
      id: documentBlocks.id,
      blockType: documentBlocks.blockType,
      canonicalText: documentBlocks.canonicalText,
      ordinal: documentBlocks.ordinal,
    })
    .from(documentBlocks)
    .where(eq(documentBlocks.policyVersionId, claimed.policyVersionId))
    .orderBy(asc(documentBlocks.ordinal));

  let cells = new Map<string, NonNullable<ContextInputBlock["cell"]>>();
  let tableStructure = false;
  if (version && !version.originalDeletedAt) {
    try {
      const aligned = alignCells(blocks, await readOriginalHtml(version.objectKey));
      cells = aligned.cells;
      tableStructure = aligned.aligned;
    } catch {
      // Ohne Original (gelöscht oder nicht lesbar) gibt es Zahlen, aber keine Tabellenlage.
    }
  }
  if (!tableStructure) {
    // Eine neue Erkennungsversion nach der 24-h-Löschung des Originals übernimmt die
    // Tabellenlage der früheren Erkennung; sie stammt aus demselben Original.
    const stored = await storedCells(caseDocumentId);
    if (stored.size > 0) {
      cells = stored;
      tableStructure = true;
    }
  }

  const inputs: ContextInputBlock[] = blocks.map((block) => ({
    id: block.id,
    blockType: block.blockType,
    text: block.canonicalText,
    cell: cells.get(block.id),
  }));
  const { reportYear, contexts } = deriveDocumentContext(inputs);

  const contextRows: Array<typeof disclosureBlockContext.$inferInsert> = [];
  const figureRows: Array<typeof disclosureFigures.$inferInsert> = [];
  const statementRows: Array<typeof disclosureStatements.$inferInsert> = [];
  for (const block of blocks) {
    const context = contexts.get(block.id)!;
    const table = context.table;
    contextRows.push({
      caseDocumentId,
      documentBlockId: block.id,
      pageNumber: context.pageNumber,
      tz: context.tz,
      tableIndex: table?.index ?? null,
      rowIndex: table?.row ?? null,
      columnIndex: table?.column ?? null,
      isHeader: table?.header ?? false,
      rowLabel: table?.rowLabel ?? null,
      columnLabel: table?.columnInfo?.label || null,
      tableCaption: table?.caption ?? null,
      technical: context.technical,
    });
    // Seitenzahlen eines Inhaltsverzeichnisses sind keine Berichtszahlen.
    if (context.technical || context.toc || table?.header) continue;
    // In einer Tabelle zählt nur, was in einer Wertespalte steht; das Label ist Text.
    const isLabelCell = table !== null && table.column === 0;
    const column = table?.columnInfo;
    const figures = isLabelCell
      ? []
      : recognizeFigures(block.canonicalText, {
          blockType: block.blockType,
          reportYear,
          columnUnit:
            column?.unit && column.scale ? { unit: column.unit, scale: column.scale } : null,
          columnPeriod: column?.period ?? null,
        });
    for (const figure of figures) {
      figureRows.push({
        caseDocumentId,
        documentBlockId: block.id,
        startOffset: figure.start,
        endOffset: figure.end,
        rawText: figure.raw,
        valueMicro: figure.micro,
        scale: figure.scale,
        unit: figure.unit,
        displayUnitMicro: figure.displayUnit,
        decimals: figure.decimals,
        periodHint: figure.periodHint,
        parseIssue: figure.issue,
        parenthesized: figure.parenthesized,
        rowLabel: table?.rowLabel ?? null,
        extractionVersion: figureExtractionVersion,
      });
    }
    for (const statement of recognizeStatements(block.canonicalText, block.blockType)) {
      statementRows.push({
        caseDocumentId,
        documentBlockId: block.id,
        startOffset: statement.start,
        endOffset: statement.end,
        rawText: statement.raw,
        kind: "direction",
        direction: statement.direction,
        extractionVersion: statementExtractionVersion,
      });
    }
    // Jahreszahlen nur als Gegenstand der Vortragsprüfung; sie werden nicht markiert.
    for (const year of recognizeYears(block.canonicalText, block.blockType)) {
      statementRows.push({
        caseDocumentId,
        documentBlockId: block.id,
        startOffset: year.start,
        endOffset: year.end,
        rawText: year.raw,
        kind: "year",
        year: year.year,
        extractionVersion: statementExtractionVersion,
      });
    }
  }

  await db.transaction(async (transaction) => {
    await transaction
      .delete(disclosureBlockContext)
      .where(eq(disclosureBlockContext.caseDocumentId, caseDocumentId));
    await transaction
      .delete(disclosureStatements)
      .where(eq(disclosureStatements.caseDocumentId, caseDocumentId));
    await transaction
      .delete(disclosureFigures)
      .where(eq(disclosureFigures.caseDocumentId, caseDocumentId));
    for (let index = 0; index < contextRows.length; index += 500) {
      await transaction
        .insert(disclosureBlockContext)
        .values(contextRows.slice(index, index + 500));
    }
    for (let index = 0; index < figureRows.length; index += 500) {
      await transaction.insert(disclosureFigures).values(figureRows.slice(index, index + 500));
    }
    for (let index = 0; index < statementRows.length; index += 500) {
      await transaction
        .insert(disclosureStatements)
        .values(statementRows.slice(index, index + 500));
    }
    await transaction
      .update(disclosureCaseDocuments)
      .set({
        recognitionStatus: "ready",
        recognitionVersion,
        recognizedAt: new Date(),
        reportYear,
        tableStructure,
      })
      .where(eq(disclosureCaseDocuments.id, caseDocumentId));
  });
  return {
    status: "ready" as const,
    figures: figureRows.length,
    statements: statementRows.length,
    tableStructure,
  };
}

export async function markRecognitionFailed(caseDocumentId: string, code: string) {
  await db
    .update(disclosureCaseDocuments)
    .set({ recognitionStatus: "failed", recognitionErrorCode: code.slice(0, 80) })
    .where(eq(disclosureCaseDocuments.id, caseDocumentId));
}
