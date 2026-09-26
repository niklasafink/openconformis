/**
 * Datumsangaben eines Berichts („Gesellschafterversammlung vom 22. April 2021“,
 * „Vertrag vom 8.12.2021“). Sie sind keine Berichtszahlen, werden aber markiert, damit
 * der Prüfer sie gegen die Unterlagen abstimmen kann. Die Stichtage des Berichtsjahres
 * und des Vorjahres (31.12. und 1.1.) stehen in fast jedem Satz und bleiben unmarkiert.
 * Reine Funktion; die Marken entstehen beim Lesen aus den unveränderlichen Blöcken.
 */

import type { ContextInputBlock } from "./document-context";
import { tableOfContentsBlockIds } from "./table-of-contents";

export type RecognizedDate = {
  start: number;
  end: number;
  raw: string;
  /** ISO-Datum „2021-04-22“. */
  iso: string;
};

const months: Record<string, number> = {
  januar: 1,
  jänner: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  mär: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

const monthAlternatives = Object.keys(months)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** „22. April 2021“, „22. Apr. 2021“, „22.04.2021“, „8.12.21“. */
const datePattern = new RegExp(
  `(?<![\\p{L}\\d.,/])(\\d{1,2})\\.\\s?(?:(\\d{1,2})\\.\\s?(\\d{4}|\\d{2})(?![\\d.,]\\d)|(${monthAlternatives})\\.?\\s+(\\d{4}))(?!\\d)`,
  "giu",
);

function daysIn(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function recognizeDates(
  text: string,
  options: Readonly<{ reportYear?: number | null }> = {},
): RecognizedDate[] {
  const found: RecognizedDate[] = [];
  const reportYear = options.reportYear ?? null;
  for (const match of text.matchAll(datePattern)) {
    const day = Number(match[1]);
    const month = match[2] ? Number(match[2]) : months[match[4]!.toLowerCase()]!;
    const yearText = match[3] ?? match[5]!;
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) continue;
    if (year < 1900 || year > 2100) continue;
    if (
      reportYear !== null &&
      ((month === 12 && day === 31 && (year === reportYear || year === reportYear - 1)) ||
        (month === 1 && day === 1 && (year === reportYear || year === reportYear - 1)))
    ) {
      continue;
    }
    const raw = match[0];
    found.push({
      start: match.index,
      end: match.index + raw.length,
      raw,
      iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }
  return found;
}

export type DocumentDate = RecognizedDate & { blockId: string };

/**
 * Die Datumsangaben eines Berichts in Blockfolge. Übersprungen werden technische
 * Blöcke, Tabellenköpfe (Spalten „31.12.2021“) und Inhaltsverzeichnisse.
 */
export function recognizeDocumentDates(
  blocks: ReadonlyArray<ContextInputBlock & { technical?: boolean; header?: boolean }>,
  reportYear: number | null,
): DocumentDate[] {
  const toc = tableOfContentsBlockIds(blocks);
  return blocks.flatMap((block) =>
    block.technical || block.header || toc.has(block.id)
      ? []
      : recognizeDates(block.text, { reportYear }).map((date) => ({
          ...date,
          blockId: block.id,
        })),
  );
}
