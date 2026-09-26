import type { TableCellPosition } from "@/domain/policies/document-structure";

import type { FigureUnit, PeriodHint } from "./figures";
import { tableOfContentsBlockIds } from "./table-of-contents";

/**
 * Leitet aus den Blöcken eines Berichts den Kontext ab, den die Zahlenerkennung und
 * die Prüfungen brauchen: PDF-Seite (Marker des Konverters), Textziffer, Tabellenlage,
 * Zeilenlabel und Spaltenkopf mit Einheit und Periode. Reine Funktion, versioniert
 * über `figureExtractionVersion`.
 */

export const pageMarkerPattern = /^PDF-Seite (\d+)$/u;
export const ocrNotePattern = /^per Texterkennung gelesen$/u;

export type ContextInputBlock = Readonly<{
  id: string;
  blockType: string;
  text: string;
  cell?: TableCellPosition;
}>;

export type ColumnInfo = {
  label: string;
  unit: FigureUnit | null;
  scale: 1 | 1_000 | 1_000_000 | null;
  period: PeriodHint | null;
};

export type BlockContext = {
  blockId: string;
  pageNumber: number | null;
  tz: string | null;
  technical: boolean;
  /** Steht in einem Inhaltsverzeichnis; seine Seitenzahlen sind keine Berichtszahlen. */
  toc: boolean;
  table: {
    index: number;
    row: number;
    column: number;
    header: boolean;
    rowLabel: string | null;
    columnInfo: ColumnInfo | null;
    caption: string | null;
  } | null;
};

const enumerationPrefix = /^(?:\d{1,2}[.)]|[a-z]{1,2}\)|[IVX]{1,4}\.|[A-H]\.)\s+/u;
const tzPattern = /^(\d{1,3})\s+\p{Lu}/u;
const numericCell = /^\(?[-–+]?\s?\d(?:[\d.,' ]*\d)?\s?%?\)?$|^[-–]$/u;
const yearPattern = /\b((?:19|20)\d{2})\b/u;

/** Das Berichtsjahr: der häufigste Stichtag „31. Dezember JJJJ“ bzw. „31.12.JJJJ“. */
export function detectReportYear(blocks: readonly ContextInputBlock[]) {
  const counts = new Map<number, number>();
  for (const block of blocks.slice(0, 400)) {
    for (const match of block.text.matchAll(
      /31\.\s?(?:Dezember|12\.)\s?((?:19|20)\d{2})|Geschäftsjahr(?:es)?\s+((?:19|20)\d{2})/gu,
    )) {
      const year = Number(match[1] ?? match[2]);
      counts.set(year, (counts.get(year) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
}

/** Zeilenlabel ohne Gliederungszeichen („1. Umsatzerlöse“ → „Umsatzerlöse“). */
export function cleanLabel(label: string) {
  return label.replace(enumerationPrefix, "").replace(/:$/u, "").trim();
}

function unitOfHeader(text: string): Pick<ColumnInfo, "unit" | "scale"> {
  if (/(?:^|[^A-Za-z])T(?:EUR|€)\b|\bTsd\.?\s?€|in TEUR/u.test(text))
    return { unit: "EUR", scale: 1_000 };
  if (/Mio\.?\s?(?:EUR|€)/u.test(text)) return { unit: "EUR", scale: 1_000_000 };
  if (/\bEUR\b|€/u.test(text)) return { unit: "EUR", scale: 1 };
  if (/%/u.test(text)) return { unit: "percent", scale: 1 };
  return { unit: null, scale: null };
}

function periodOfHeader(text: string, reportYear: number | null): PeriodHint | null {
  if (/Vorjahr|\bVj\b|i\.\s?Vj/iu.test(text)) return "prior";
  if (/Veränderung|Differenz/iu.test(text)) return "other";
  const year = yearPattern.exec(text)?.[1];
  if (!year || !reportYear) return null;
  const value = Number(year);
  return value === reportYear ? "current" : value === reportYear - 1 ? "prior" : "other";
}

type Cell = { block: ContextInputBlock; position: TableCellPosition };

/**
 * Spaltenköpfe einer Tabelle: Kopfzeilen sind die Zeilen oben, deren Wertespalten
 * keine Beträge tragen (Jahre, Stichtage, Einheiten). Leere Köpfe übernehmen den
 * linken Nachbarn einer zusammengefassten Kopfzeile („Inland“ über 2025 und 2024)
 * bzw. Einheit und Periode vom rechten Nachbarn (Detailspalte neben der Summenspalte
 * „31.12.2021“ in der gbs-Bilanz).
 */
function tableColumns(cells: readonly Cell[], reportYear: number | null) {
  const rows = new Map<number, Cell[]>();
  for (const cell of cells) {
    const list = rows.get(cell.position.row) ?? [];
    list.push(cell);
    rows.set(cell.position.row, list);
  }
  const width = Math.max(0, ...cells.map((cell) => cell.position.column)) + 1;
  const headerRows: number[] = [];
  let labelUnit: Pick<ColumnInfo, "unit" | "scale"> = { unit: null, scale: null };
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const values = rows.get(row)!.filter((cell) => cell.position.column > 0);
    // Zeilen nur mit einem Text in der ersten Spalte („Fristigkeit (Restlaufzeit)“,
    // „__TEUR“) beenden die Kopfzeilen nicht; eine Einheit darin gilt für die Tabelle.
    if (values.length === 0) {
      if (headerRows.length < 4) {
        const label = rows.get(row)!.find((cell) => cell.position.column === 0)?.block.text ?? "";
        const unit = unitOfHeader(label);
        if (unit.unit && label.length <= 40) labelUnit = unit;
        continue;
      }
      break;
    }
    const isHeader =
      values.length > 0 &&
      values.every(
        (cell) =>
          cell.position.header ||
          !numericCell.test(cell.block.text.trim()) ||
          /^(?:19|20)\d{2}$/u.test(cell.block.text.trim()),
      );
    if (!isHeader) break;
    headerRows.push(row);
  }
  const labels: string[][] = Array.from({ length: width }, () => []);
  for (const row of headerRows) {
    const texts: Array<string | null> = Array.from({ length: width }, () => null);
    for (const cell of rows.get(row)!) {
      if (cell.position.column > 0) texts[cell.position.column] = cell.block.text.trim();
    }
    const filled = texts.filter((text) => text !== null).length;
    // Weniger Köpfe als Spalten: Gruppenkopf, er gilt auch für die Nachbarspalten.
    if (filled > 0 && filled < width - 1) {
      let last: string | null = null;
      for (let column = 1; column < width; column += 1) {
        if (texts[column]) last = texts[column] ?? null;
        else if (last && filled * 2 >= width - 1) texts[column] = last;
      }
    }
    texts.forEach((text, column) => {
      if (text) labels[column]!.push(text);
    });
  }
  const columns: ColumnInfo[] = labels.map((parts) => {
    const label = parts.join(" · ");
    return { label, ...unitOfHeader(label), period: periodOfHeader(label, reportYear) };
  });
  // Detailspalten ohne eigenen Kopf erben vom rechten Nachbarn.
  for (let column = width - 2; column >= 1; column -= 1) {
    const current = columns[column]!;
    const right = columns[column + 1]!;
    if (!current.label) {
      columns[column] = { ...right, label: right.label };
    } else {
      if (current.period === null && right.period !== null && !yearPattern.test(current.label)) {
        current.period = right.period;
      }
      if (current.unit === null && right.unit !== null) {
        current.unit = right.unit;
        current.scale = right.scale;
      }
    }
  }
  // Einheit aus einer Tabellenkopfzeile „EUR | EUR | EUR“ gilt für alle Spalten ohne eigene.
  const tableUnit = columns.find((column) => column.unit)?.unit ?? labelUnit.unit;
  const tableScale = columns.find((column) => column.unit)?.scale ?? labelUnit.scale;
  for (const column of columns) {
    if (!column.unit && tableUnit) {
      column.unit = tableUnit;
      column.scale = tableScale;
    }
  }
  return { columns, headerRows: new Set(headerRows), rows };
}

export function deriveDocumentContext(blocks: readonly ContextInputBlock[]) {
  const reportYear = detectReportYear(blocks);
  const tocIds = tableOfContentsBlockIds(blocks);
  const contexts = new Map<string, BlockContext>();
  const tables = new Map<number, Cell[]>();
  const captions = new Map<number, string>();
  /** Lage jeder Tabelle in der Blockfolge und ihre PDF-Seite, für Fortsetzungstabellen. */
  const spans = new Map<number, { first: number; last: number; page: number | null }>();
  let page: number | null = null;
  let tz: string | null = null;
  let lastHeading: string | null = null;
  let lastParagraph: string | null = null;

  for (const [position, block] of blocks.entries()) {
    const text = block.text.trim();
    const marker = pageMarkerPattern.exec(text);
    if (marker) page = Number(marker[1]);
    const technical = marker !== null || ocrNotePattern.test(text);
    if (block.blockType === "paragraph" && !technical) {
      const match = tzPattern.exec(text);
      if (match) tz = match[1]!;
      // Die Anlagen (Jahresabschluss, Lagebericht) haben keine Textziffern mehr.
      else if (/^(?:Anlage|Beilage)\s+\d/u.test(text)) tz = null;
    }
    if (block.blockType === "heading") {
      lastHeading = text;
      // Eine neue Gliederung beendet die Textziffer des vorigen Abschnitts nicht:
      // im gbs-Bericht stehen Überschriften zwischen den Tz.
    }
    if (block.cell) {
      const list = tables.get(block.cell.table) ?? [];
      list.push({ block, position: block.cell });
      tables.set(block.cell.table, list);
      const span = spans.get(block.cell.table);
      spans.set(block.cell.table, {
        first: span?.first ?? position,
        last: position,
        page: span?.page ?? page,
      });
      // Überschrift der Tabelle: der kurze Satz direkt davor oder die letzte Gliederung.
      if (!captions.has(block.cell.table)) {
        const caption = lastParagraph && lastParagraph.length <= 140 ? lastParagraph : lastHeading;
        if (caption) captions.set(block.cell.table, caption);
      }
    } else if (!technical) {
      lastParagraph = block.blockType === "heading" ? null : text;
    }
    contexts.set(block.id, {
      blockId: block.id,
      pageNumber: page,
      tz,
      technical,
      toc: tocIds.has(block.id),
      table: null,
    });
  }

  // Eine Tabelle ohne eigene Kopfzeile direkt nach einer gleich breiten Tabelle derselben
  // Seite setzt diese fort: der Konverter trennt Bilanzen an „darunter:“-Zeilen.
  const columnsByTable = new Map<number, ColumnInfo[]>();
  for (const index of [...tables.keys()].sort((a, b) => a - b)) {
    const cells = tables.get(index)!;
    const layout = tableColumns(cells, reportYear);
    const previous = columnsByTable.get(index - 1);
    const span = spans.get(index);
    const previousSpan = spans.get(index - 1);
    const width = layout.columns.length;
    const adjacent =
      layout.headerRows.size === 0 &&
      previous !== undefined &&
      span !== undefined &&
      previousSpan !== undefined &&
      span.page === previousSpan.page &&
      span.first - previousSpan.last <= 5 &&
      previous.slice(1).some((column) => column.period !== null || column.unit !== null);
    let columns = layout.columns;
    let continues = false;
    if (adjacent && previous.length === width) {
      columns = previous;
      continues = true;
    } else if (adjacent && width - 1 === (previous.length - 1) * 2) {
      // Fortsetzung mit Einzel- und Summenspalte je Jahr (ICBC-GuV): je zwei Spalten
      // gehören zu einer Kopfspalte.
      columns = [previous[0]!, ...previous.slice(1).flatMap((column) => [column, column])];
      continues = true;
    } else if (adjacent && (width - 1) * 2 === previous.length - 1) {
      // Zurück zu einer Spalte je Jahr: es gilt die Summenspalte.
      columns = [previous[0]!, ...previous.slice(1).filter((_, index) => index % 2 === 1)];
      continues = true;
    }
    columnsByTable.set(index, columns);
    if (continues && captions.has(index - 1)) {
      captions.set(index, captions.get(index - 1)!);
    }
  }

  for (const [index, cells] of tables) {
    const { headerRows, rows } = tableColumns(cells, reportYear);
    const columns = columnsByTable.get(index)!;
    // Steht der Titel in der ersten Spalte einer Kopfzeile, ist er die Überschrift.
    const headerTitle = cells.find(
      (cell) => headerRows.has(cell.position.row) && cell.position.column === 0,
    )?.block.text;
    if (headerTitle && /\p{L}{4}/u.test(headerTitle)) captions.set(index, cleanLabel(headerTitle));
    for (const cell of cells) {
      const labelCell = rows.get(cell.position.row)?.find((entry) => entry.position.column === 0);
      const context = contexts.get(cell.block.id)!;
      context.table = {
        index,
        row: cell.position.row,
        column: cell.position.column,
        header: headerRows.has(cell.position.row) || cell.position.header,
        rowLabel: labelCell ? cleanLabel(labelCell.block.text) : null,
        columnInfo: cell.position.column > 0 ? (columns[cell.position.column] ?? null) : null,
        caption: captions.get(index) ?? null,
      };
    }
  }
  return { reportYear, contexts };
}
