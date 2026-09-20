import ExcelJS from "exceljs";

import type { ReviewColumnCriteria } from "@/domain/review/column";

import { safeExcelText } from "./analysis-xlsx";

/**
 * Rasterexport der Vertragsprüfung: ein Blatt Raster — eine Zeile je Dokument, eine
 * Spalte je Entscheidung —, ein Blatt Belege. Zellen, die Aufmerksamkeit brauchen
 * (`needs_review`, `failed`, verlassen, noch offen), sind im Text **und** farbig
 * markiert; die Bedeutung hängt nie allein an der Farbe.
 */

export type ReviewExportCell = {
  runDocumentId: string;
  runColumnId: string;
  state: string;
  source: string | null;
  answerBoolean: boolean | null;
  answerChoice: string | null;
  answerScoreBp: number | null;
  probabilityBp: number | null;
  citationVerdict: string | null;
  failureCode: string | null;
  rationale: string | null;
  confirmedAt: Date | null;
  override: {
    answerBoolean: boolean | null;
    answerChoice: string | null;
    answerScoreBp: number | null;
    reason: string;
  } | null;
  evidence: Array<{
    citationOrder: number;
    support: string;
    exactQuote: string;
    pageNumber: number | null;
    paragraphNumber: number | null;
  }>;
};

export type ReviewExportData = {
  id: string;
  name: string;
  locale: string;
  status: string;
  decisionEngine: string;
  createdAt: Date;
  completedAt: Date | null;
  documents: Array<{ id: string; displayName: string }>;
  columns: Array<{
    id: string;
    label: string;
    columnType: "noul" | "choice" | "score";
    criteria: ReviewColumnCriteria;
  }>;
  cells: ReviewExportCell[];
};

type ExportLocale = "de" | "en";

const palette = {
  text: "FF172B4D",
  border: "FFDFE1E6",
  header: "FFF1F2F4",
  amber: "FFFFF3EB",
  red: "FFFFEDEB",
  grey: "FFF1F2F4",
} as const;

const translations = {
  de: {
    grid: "Raster",
    evidence: "Belege",
    document: "Dokument",
    column: "Spalte",
    citation: "Beleg",
    support: "Belegtyp",
    quote: "Exaktes Zitat",
    page: "Seite",
    paragraph: "Absatz",
    yes: "Ja",
    no: "Nein",
    needsReview: "Prüfung nötig",
    failed: "Fehlgeschlagen",
    abandoned: "Nicht abgeschlossen",
    open: "Noch offen",
    overridden: "überschrieben",
    confirmed: "bestätigt",
    fabricated: "Zitat nicht im Dokument",
    supports: "stützt",
    contradicts: "widerspricht",
    context: "Kontext",
    noEvidence: "Keine Belegstelle im Dokument gefunden.",
  },
  en: {
    grid: "Grid",
    evidence: "Evidence",
    document: "Document",
    column: "Column",
    citation: "Citation",
    support: "Evidence type",
    quote: "Exact quote",
    page: "Page",
    paragraph: "Paragraph",
    yes: "Yes",
    no: "No",
    needsReview: "Needs review",
    failed: "Failed",
    abandoned: "Not completed",
    open: "Still open",
    overridden: "overridden",
    confirmed: "confirmed",
    fabricated: "Quote not in document",
    supports: "supports",
    contradicts: "contradicts",
    context: "context",
    noEvidence: "No supporting passage found in the document.",
  },
} as const;

function localeOf(locale: string): ExportLocale {
  return locale.toLowerCase().startsWith("en") ? "en" : "de";
}

type Answer = {
  answerBoolean: boolean | null;
  answerChoice: string | null;
  answerScoreBp: number | null;
};

/** Der Wert einer Antwort in der Sprache des Nutzers — über das Beschriftungskriterium. */
function describeAnswer(criteria: ReviewColumnCriteria, answer: Answer) {
  if (criteria.type === "noul" && answer.answerBoolean !== null) {
    return answer.answerBoolean ? criteria.true.label : criteria.false.label;
  }
  if (criteria.type === "choice" && answer.answerChoice !== null) {
    return criteria.options.find((option) => option.key === answer.answerChoice)?.label;
  }
  if (criteria.type === "score" && answer.answerScoreBp !== null) {
    const last = criteria.levels.length - 1;
    const level = last === 0 ? 0 : Math.round((answer.answerScoreBp / 10_000) * last);
    return criteria.levels[level]?.label;
  }
  return undefined;
}

/** Was in der Rasterzelle steht. Der Zustand steht im Text, nicht nur in der Farbe. */
export function describeReviewCell(
  column: ReviewExportData["columns"][number],
  cell: ReviewExportCell | undefined,
  locale: ExportLocale,
): { text: string; tone: "ok" | "attention" | "failed" | "neutral" } {
  const t = translations[locale];
  if (!cell) return { text: t.open, tone: "neutral" };
  if (cell.state === "failed") {
    return {
      text: `[${t.failed}${cell.failureCode ? `: ${cell.failureCode}` : ""}]`,
      tone: "failed",
    };
  }
  if (cell.state === "abandoned") return { text: `[${t.abandoned}]`, tone: "failed" };
  if (!["complete", "needs_review"].includes(cell.state)) {
    return { text: `[${t.open}]`, tone: "neutral" };
  }

  const effective: Answer = cell.override ?? cell;
  const value = describeAnswer(column.criteria, effective) ?? "";
  const probability =
    !cell.override && cell.probabilityBp !== null
      ? ` (${(cell.probabilityBp / 100).toFixed(cell.probabilityBp % 100 === 0 ? 0 : 1)} %)`
      : "";
  const notes = [
    cell.override ? t.overridden : undefined,
    cell.confirmedAt ? t.confirmed : undefined,
    cell.citationVerdict === "fabricated" ? t.fabricated : undefined,
  ].filter(Boolean);
  // Eine überschriebene Zelle hat ein Mensch entschieden — sie braucht keine Prüfung mehr.
  const needsReview = cell.state === "needs_review" && !cell.override && !cell.confirmedAt;
  const marker = needsReview ? `[${t.needsReview}] ` : "";
  return {
    text: `${marker}${value}${probability}${notes.length > 0 ? ` — ${notes.join(", ")}` : ""}`,
    tone: needsReview ? "attention" : "ok",
  };
}

function toneFill(tone: "ok" | "attention" | "failed" | "neutral") {
  if (tone === "attention") return palette.amber;
  if (tone === "failed") return palette.red;
  if (tone === "neutral") return palette.grey;
  return undefined;
}

export async function buildReviewXlsx(data: ReviewExportData): Promise<Uint8Array> {
  const locale = localeOf(data.locale);
  const t = translations[locale];
  const workbook = new ExcelJS.Workbook();
  workbook.title = data.name;
  workbook.created = data.completedAt ?? data.createdAt;
  workbook.modified = data.completedAt ?? data.createdAt;
  workbook.calcProperties.fullCalcOnLoad = false;

  const cellByKey = new Map(
    data.cells.map((cell) => [`${cell.runDocumentId}:${cell.runColumnId}`, cell]),
  );

  const grid = workbook.addWorksheet(t.grid, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
  });
  grid.columns = [{ width: 38 }, ...data.columns.map(() => ({ width: 34 }))];
  const header = grid.addRow([
    t.document,
    ...data.columns.map((column) => safeExcelText(column.label)),
  ]);
  header.height = 28;
  header.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: palette.text } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.header } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  for (const document of data.documents) {
    const described = data.columns.map((column) =>
      describeReviewCell(column, cellByKey.get(`${document.id}:${column.id}`), locale),
    );
    const row = grid.addRow([
      safeExcelText(document.displayName),
      ...described.map((entry) => safeExcelText(entry.text)),
    ]);
    row.alignment = { vertical: "top", wrapText: true };
    described.forEach((entry, index) => {
      const cell = row.getCell(index + 2);
      cell.font = { name: "Aptos", size: 10, color: { argb: palette.text } };
      cell.border = { bottom: { style: "hair", color: { argb: palette.border } } };
      const fill = toneFill(entry.tone);
      if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    });
  }

  const evidence = workbook.addWorksheet(t.evidence, { views: [{ state: "frozen", ySplit: 1 }] });
  evidence.columns = [
    { width: 34 },
    { width: 30 },
    { width: 9 },
    { width: 14 },
    { width: 80 },
    { width: 8 },
    { width: 9 },
  ];
  const evidenceHeader = evidence.addRow([
    t.document,
    t.column,
    t.citation,
    t.support,
    t.quote,
    t.page,
    t.paragraph,
  ]);
  evidenceHeader.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: palette.text } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.header } };
  });
  const documentName = new Map(
    data.documents.map((document) => [document.id, document.displayName]),
  );
  const columnLabel = new Map(data.columns.map((column) => [column.id, column.label]));
  for (const cell of data.cells) {
    if (!["complete", "needs_review"].includes(cell.state)) continue;
    // Eine Zelle ohne Beleg bekommt eine ausdrückliche Leermeldung statt einer stillen Lücke.
    if (cell.evidence.length === 0) {
      evidence.addRow([
        safeExcelText(documentName.get(cell.runDocumentId) ?? ""),
        safeExcelText(columnLabel.get(cell.runColumnId) ?? ""),
        "",
        "",
        t.noEvidence,
        "",
        "",
      ]);
      continue;
    }
    for (const citation of cell.evidence) {
      evidence.addRow([
        safeExcelText(documentName.get(cell.runDocumentId) ?? ""),
        safeExcelText(columnLabel.get(cell.runColumnId) ?? ""),
        `[${citation.citationOrder}]`,
        t[citation.support as "supports" | "contradicts" | "context"] ?? citation.support,
        safeExcelText(citation.exactQuote),
        citation.pageNumber ?? "",
        citation.paragraphNumber ?? "",
      ]);
    }
  }
  evidence.eachRow((row, index) => {
    if (index === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell((cell) => {
      cell.font = { name: "Aptos", size: 10, color: { argb: palette.text } };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  return new Uint8Array(buffer);
}

export function createReviewExportFilename(data: Pick<ReviewExportData, "name" | "id">) {
  const name = data.name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `vertragspruefung-${name || "raster"}-${data.id.slice(0, 8)}.xlsx`;
}
