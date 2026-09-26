import { abs, compareWithTolerance } from "../arithmetic";

import { formatAmount, formatDifference } from "./comments";
import { normalizeLabel } from "./posten";
import { buildTables, isAmountColumn, type TableModel } from "./tables";
import type { CheckDraft, EngineBlock, EngineDocument, EngineFigure, EngineYear } from "./types";

/**
 * Vortrag gegen den Vorjahresbericht. Ein Prüfungsbericht entsteht meist, indem der
 * Vorjahresbericht fortgeschrieben wird; dabei bleiben Jahreszahlen und Vorjahreswerte
 * stehen. Zwei deterministische Prüfungen, kein Modell:
 *
 * - `rollover`: eine Jahreszahl im Fließtext, die das Berichtsjahr sein müsste. Ohne
 *   Vorjahresbericht nur als Verdacht (orange) über eindeutige Stichtagsformeln; mit ihm
 *   sicher (rot), wenn der Absatz bis auf Beträge wortgleich im Vorjahresbericht steht
 *   und dessen Berichtsjahr dort unverändert trägt.
 * - `prior_report`: jeder Wert einer Vorjahresspalte gegen den Wert des Berichtsjahrs
 *   im Vorjahresbericht. Nur bei eindeutigem Zeilenlabel in beiden Berichten; sonst
 *   entsteht keine Prüfung statt einer geratenen.
 */

const stichtagBefore =
  /(?:31\.\s?(?:Dezember|12\.)\s?|Geschäftsjahr(?:es)?\s+|Berichtsjahr(?:es)?\s+|Wirtschaftsjahr(?:es)?\s+|zum\s+|per\s+)$/iu;
/** Wendungen, in denen ein früheres Jahr gewollt ist: Vergleich, Vorperiode, Historie. */
const comparisonWords =
  /Vorjahr|Vorperiode|vorangegangen|vorhergehend|endende|gegenüber|im Vergleich|verglichen|seit|nach EUR|bis zum|anderen Abschlussprüfer|durch einen anderen|Vorgänger|\(\s*(?:19|20)\d{2}\s*:/iu;

function isProse(block: EngineBlock) {
  return !block.technical && !block.table && block.type !== "table_cell";
}

/** Fließtext mit maskierten Beträgen; Jahreszahlen bleiben stehen. */
function template(text: string) {
  return text
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\d[\d.,']*\d|\d/gu, (digits) => (/^(?:19|20)\d{2}$/u.test(digits) ? digits : "#"));
}

/** „ (Seite 7)“ für den Kommentar, leer ohne Seitenangabe. */
function pageNote(block: EngineBlock | undefined) {
  return block?.page ? ` (Seite ${block.page})` : "";
}

function priorSource(block: EngineBlock | undefined, label?: string) {
  return ["Vorjahresbericht", block?.page ? `Seite ${block.page}` : null, label ?? null]
    .filter(Boolean)
    .join(" · ");
}

function yearDraft(
  year: EngineYear,
  status: "mismatch" | "uncertain",
  code: "year_suspect" | "year_not_rolled",
  params: Record<string, string>,
  sourceBlockIds: string[],
  sourceLabel: string,
): CheckDraft {
  return {
    kind: "rollover",
    status,
    subjectFigureId: null,
    subjectStatementId: year.id,
    actual: null,
    expected: null,
    tolerance: null,
    rounded: false,
    sourceKind: status === "mismatch" ? "prior_report" : "text",
    sourceFigureIds: [],
    sourceBlockIds,
    sourceLabel,
    comment: { code, params: { year: year.raw, ...params } },
    assignment: "rule",
    confidenceBp: null,
    sourceKey: `rollover:${code}`,
    subjectLabel: year.raw,
  };
}

export function rolloverChecks(
  document: EngineDocument,
  prior: EngineDocument | null,
): CheckDraft[] {
  const reportYear = document.reportYear;
  const years = document.years ?? [];
  if (!reportYear || years.length === 0) return [];
  const priorYear = prior?.reportYear ?? null;
  // Nur ein Vorjahresbericht des unmittelbar vorangehenden Jahres ist ein Vortrag.
  const usablePrior = prior && priorYear === reportYear - 1 ? prior : null;
  const priorTemplates = new Map<string, EngineBlock>();
  for (const block of usablePrior?.blocks ?? []) {
    if (isProse(block)) priorTemplates.set(template(block.text), block);
  }

  const blocks = new Map(document.blocks.map((block) => [block.id, block]));
  const drafts: CheckDraft[] = [];
  for (const year of years) {
    const block = blocks.get(year.blockId);
    if (!block || !isProse(block)) continue;
    const before = block.text.slice(Math.max(0, year.start - 30), year.start);
    const after = block.text.slice(year.end, year.end + 3);
    // „(2023: …)“: die Vergleichsangabe, die im Bericht 2025 „(2024: …)“ lauten müsste.
    const comparative = /\(\s*$/u.test(before);
    const stale =
      year.year === reportYear - 1 ? !comparative : comparative && year.year === reportYear - 2;
    if (!stale) continue;
    const twin = priorTemplates.get(template(block.text));
    if (twin) {
      drafts.push(
        yearDraft(
          year,
          "mismatch",
          "year_not_rolled",
          { source: pageNote(twin), reportYear: String(reportYear) },
          [twin.id],
          priorSource(twin),
        ),
      );
      continue;
    }
    if (!comparative) {
      if (!stichtagBefore.test(before) || /^\s*:/u.test(after)) continue;
      if (comparisonWords.test(block.text)) continue;
    }
    drafts.push(
      yearDraft(
        year,
        "uncertain",
        "year_suspect",
        { reportYear: String(comparative ? reportYear - 1 : reportYear) },
        [],
        `Berichtsjahr ${reportYear}`,
      ),
    );
  }
  return drafts;
}

type Located = { figure: EngineFigure; label: string };

function digitsOf(text: string) {
  return text.replace(/\D/gu, "");
}

/** Werte je normalisiertem Zeilenlabel einer Periode, nur Betragsspalten. */
function valuesByLabel(tables: readonly TableModel[], period: "current" | "prior") {
  const byLabel = new Map<string, Located[]>();
  for (const table of tables) {
    if (table.alternate) continue;
    for (const row of table.rows) {
      const inPeriod: EngineFigure[] = [];
      for (const [columnIndex, cell] of row.cells) {
        const figure = cell.figure;
        if (!figure || figure.micro === null || figure.issue) continue;
        // „395 357“ als zwei Zahlen gelesen: die Zelle hat mehr Ziffern als die Zahl.
        if (digitsOf(cell.text) !== digitsOf(figure.raw)) continue;
        const column = table.columns.get(columnIndex);
        if (!column || !isAmountColumn(column) || column.change || column.percent) continue;
        if ((figure.period ?? column.period) === period) inPeriod.push(figure);
      }
      // Zwei Beträge derselben Periode in einer Zeile: Spaltenkopf oder Zahl nicht sicher
      // gelesen. Dann lieber keine Prüfung als eine gegen den falschen Wert.
      if (inPeriod.length !== 1) continue;
      for (const figure of inPeriod) {
        const label = table.labels.get(figure.id)?.label ?? row.label;
        const key = normalizeLabel(label).toLowerCase();
        if (key.length < 4 || /^(?:summe|gesamt|insgesamt|total)$/u.test(key)) continue;
        const list = byLabel.get(key) ?? [];
        list.push({ figure, label });
        byLabel.set(key, list);
      }
    }
  }
  return byLabel;
}

/** Ein Label ist eindeutig, wenn alle seine Werte innerhalb der Rundung übereinstimmen. */
function unique(list: readonly Located[] | undefined) {
  if (!list || list.length === 0) return null;
  const [first] = list;
  const agree = list.every(
    ({ figure }) =>
      compareWithTolerance(
        { micro: figure.micro!, displayUnit: figure.displayUnit },
        { micro: first!.figure.micro!, displayUnit: first!.figure.displayUnit },
      ).status === "match",
  );
  return agree ? first! : null;
}

export function priorReportChecks(
  tables: readonly TableModel[],
  prior: EngineDocument | null,
  reportYear: number | null,
): CheckDraft[] {
  if (!prior || !reportYear || prior.reportYear !== reportYear - 1) return [];
  const priorBlocks = new Map(prior.blocks.map((block) => [block.id, block]));
  const reported = valuesByLabel(buildTables(prior), "current");
  const drafts: CheckDraft[] = [];
  for (const [key, list] of valuesByLabel(tables, "prior")) {
    // Eindeutig muss nur der Vorjahresbericht sein; im Bericht zählt jede Nennung einzeln.
    const reference = unique(reported.get(key));
    if (!reference) continue;
    for (const { figure, label } of list) {
      const actual = figure.micro!;
      const comparison = compareWithTolerance(
        { micro: abs(actual), displayUnit: figure.displayUnit },
        { micro: abs(reference.figure.micro!), displayUnit: reference.figure.displayUnit },
      );
      // Vorzeichen zählt mit: ein Verlust darf im Vortrag kein Gewinn werden.
      const signFlip =
        actual !== 0n &&
        reference.figure.micro! !== 0n &&
        actual < 0n !== reference.figure.micro! < 0n &&
        !figure.parenthesized &&
        !reference.figure.parenthesized;
      const status = comparison.status === "match" && !signFlip ? "match" : "mismatch";
      const format = { unit: figure.unit, scale: figure.scale, decimals: figure.decimals };
      const referenceBlock = priorBlocks.get(reference.figure.blockId);
      drafts.push({
        kind: "prior_report",
        status,
        subjectFigureId: figure.id,
        subjectStatementId: null,
        actual,
        expected: reference.figure.micro!,
        tolerance: comparison.tolerance,
        rounded: comparison.rounded,
        sourceKind: "prior_report",
        sourceFigureIds: [reference.figure.id],
        sourceBlockIds: [reference.figure.blockId],
        sourceLabel: priorSource(referenceBlock, reference.label),
        comment: {
          code: status === "match" ? "prior_report_matches" : "prior_report_differs",
          params: {
            source: pageNote(referenceBlock),
            expected: formatAmount(reference.figure.micro!, format),
            difference: formatDifference(
              signFlip ? abs(actual) + abs(reference.figure.micro!) : comparison.difference,
              format,
            ),
            rounded: comparison.rounded ? "1" : "0",
          },
        },
        assignment: "rule",
        confidenceBp: null,
        sourceKey: `prior_report:${reference.figure.id}`,
        subjectLabel: label,
      });
    }
  }
  return drafts;
}
