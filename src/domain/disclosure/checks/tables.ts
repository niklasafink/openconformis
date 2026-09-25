import { abs, compareWithTolerance, sum } from "../arithmetic";

import { formatAmount, formatDifference } from "./comments";
import { normalizeLabel } from "./posten";
import type { CheckDraft, EngineBlock, EngineDocument, EngineFigure } from "./types";

/**
 * Tabellen des Berichts als Zeilen und Spalten mit erkannten Zahlen. Aus Word-Tabellen
 * der konvertierten Berichte entstehen drei Formen, die hier unterschieden werden:
 *
 * - Staffelform (gbs-Bilanz): Einzelposten in der linken, Summen in der rechten Spalte
 *   derselben Periode; eine Summe steht nach ihren Posten, oft eine Zeile tiefer.
 * - Gliederung mit Unterposten (ICBC-Formblatt): „3. … 234.414.817,04“ vor „a) … b) …“.
 * - Einfache Listen mit Summenzeile („Summe“, „Bilanzsumme“) oder Zwischensummen ohne
 *   eigenes Summenwort (gbs Anlage 2.1).
 *
 * Rot entsteht nur, wenn die Komponenten einer Summe sicher feststehen; sonst bleibt es
 * bei „unsicher“ ohne Feststellung.
 */

export type TableCell = { figure: EngineFigure | null; text: string; blockId: string };

export type TableRow = {
  index: number;
  rawLabel: string;
  label: string;
  cells: Map<number, TableCell>;
  davon: boolean;
  level: number | null;
};

export type TableColumn = {
  index: number;
  label: string;
  group: string;
  period: "current" | "prior" | "other" | null;
  percent: boolean;
  change: boolean;
};

export type TableModel = {
  id: number;
  caption: string | null;
  page: number | null;
  rows: TableRow[];
  columns: Map<number, TableColumn>;
  /** Abweichende Gliederung (ordentlich/neutral): Vergleiche mit ihr bleiben unsicher. */
  alternate: boolean;
  /** Effektives Label je Zahl, auch nach Korrektur verschobener Summenzeilen. */
  labels: Map<string, { label: string; relabeled: boolean }>;
};

const totalWord =
  /^(?:Summe|Gesamt|Insgesamt|Total|Bilanzsumme)\b|\binsgesamt$|^Summe der (?:Aktiva|Passiva)$/iu;
const grandTotal = /^(?:Summe der (?:Aktiva|Passiva)|Bilanzsumme|Summe (?:Aktiva|Passiva))$/iu;
const sectionHeader = /^(?:Aktiva|Passiva|Posten unter der Bilanz)$/iu;
const resultWord =
  /(?:ergebnis|überschuss|fehlbetrag|Rohertrag|Gesamtleistung|Betriebserträge|Betriebsaufwendungen|Nettozinsertrag)/iu;
const expenseWord =
  /(?:aufwand|aufwendungen|Löhne|Gehälter|Soziale Abgaben|Abschreibungen|Steuern|Materialeinsatz|Wertberichtigungen auf)/iu;
const alternateWord =
  /(?<![\p{L}])(?:neutrales?|ordentliche[nrs]?|periodenfremde[nrs]?|Sondereinfl\p{L}*)(?![\p{L}])/iu;

export function enumerationLevel(rawLabel: string) {
  const text = rawLabel.trim();
  if (/^[A-H]\.\s/u.test(text)) return 1;
  if (/^[IVX]{1,4}\.\s/u.test(text)) return 2;
  if (/^\d{1,2}[a-z]?\.\s/u.test(text)) return 3;
  if (/^[a-z]\)\s/u.test(text) || /^\([a-z]\)\s/u.test(text)) return 4;
  if (/^[a-z]{2}\)\s/u.test(text)) return 5;
  return null;
}

function isDavon(rawLabel: string) {
  return /^(?:davon|darunter|thereof)\b/iu.test(rawLabel.trim());
}

type RawTable = { index: number; blocks: EngineBlock[]; firstOrdinal: number; lastOrdinal: number };

/** Baut die Tabellen; Fortsetzungen derselben Tabelle (gleiche Spalten) werden verbunden. */
export function buildTables(document: EngineDocument): TableModel[] {
  const figuresByBlock = new Map<string, EngineFigure[]>();
  for (const figure of document.figures) {
    const list = figuresByBlock.get(figure.blockId) ?? [];
    list.push(figure);
    figuresByBlock.set(figure.blockId, list);
  }
  const raw = new Map<number, RawTable>();
  for (const block of document.blocks) {
    if (!block.table) continue;
    const entry = raw.get(block.table.index) ?? {
      index: block.table.index,
      blocks: [],
      firstOrdinal: block.ordinal,
      lastOrdinal: block.ordinal,
    };
    entry.blocks.push(block);
    entry.lastOrdinal = block.ordinal;
    raw.set(block.table.index, entry);
  }
  const ordered = [...raw.values()].sort((a, b) => a.index - b.index);
  const blocksByOrdinal = new Map(document.blocks.map((block) => [block.ordinal, block]));

  const groups: RawTable[][] = [];
  for (const table of ordered) {
    const previous = groups.at(-1)?.at(-1);
    if (previous && continuesTable(previous, table)) groups.at(-1)!.push(table);
    else groups.push([table]);
  }

  return groups.map((group) => {
    const rows: TableRow[] = [];
    const columns = new Map<number, TableColumn>();
    for (const [position, table] of group.entries()) {
      // „darunter:“ zwischen zwei Teilen: die erste Zeile des Folgeteils ist ein Davon-Posten.
      let davonFirst = false;
      if (position > 0) {
        for (
          let ordinal = group[position - 1]!.lastOrdinal + 1;
          ordinal < table.firstOrdinal;
          ordinal++
        ) {
          const between = blocksByOrdinal.get(ordinal);
          if (between && /\bdarunter\b/iu.test(between.text)) davonFirst = true;
        }
      }
      const byRow = new Map<number, EngineBlock[]>();
      for (const block of table.blocks) {
        if (block.table!.header) continue;
        const list = byRow.get(block.table!.row) ?? [];
        list.push(block);
        byRow.set(block.table!.row, list);
      }
      for (const block of table.blocks) {
        const context = block.table!;
        if (context.column === 0 || columns.has(context.column)) continue;
        const label = context.columnLabel ?? "";
        columns.set(context.column, {
          index: context.column,
          label,
          group: label.split(" · ")[0]?.trim() ?? "",
          period: null,
          percent: false,
          change: /Veränderung|Differenz|Abweichung/iu.test(label),
        });
      }
      const partStart = rows.length;
      for (const [, blocks] of [...byRow].sort((a, b) => a[0] - b[0])) {
        const labelBlock = blocks.find((block) => block.table!.column === 0);
        const rawLabel = labelBlock?.text.trim() ?? "";
        const cells = new Map<number, TableCell>();
        for (const block of blocks) {
          if (block.table!.column === 0) continue;
          const figure = (figuresByBlock.get(block.id) ?? [])[0] ?? null;
          cells.set(block.table!.column, { figure, text: block.text.trim(), blockId: block.id });
        }
        rows.push({
          index: rows.length,
          rawLabel,
          label: normalizeLabel(labelBlock?.table?.rowLabel ?? rawLabel),
          cells,
          davon: isDavon(rawLabel) || (davonFirst && rows.length === partStart),
          level: enumerationLevel(rawLabel),
        });
      }
    }
    // Periode und Prozentspalte aus den Zahlen der Spalte.
    for (const column of columns.values()) {
      const figures = rows
        .map((row) => row.cells.get(column.index)?.figure)
        .filter((figure): figure is EngineFigure => Boolean(figure));
      column.percent =
        figures.length > 0 &&
        figures.filter((figure) => figure.unit === "percent").length * 2 > figures.length;
      const periods = figures.map((figure) => figure.period);
      column.period = periods.find((period) => period !== null) ?? null;
    }
    markComputedChangeColumns(rows, columns);
    markShareColumns(rows, columns);
    const first = group[0]!;
    const firstBlock = first.blocks[0]!;
    const model: TableModel = {
      id: first.index,
      caption: firstBlock.table?.caption ?? null,
      page: firstBlock.page,
      rows,
      columns,
      alternate: rows.some((row) => alternateWord.test(row.label)),
      labels: new Map(),
    };
    for (const row of rows) {
      for (const cell of row.cells.values()) {
        if (cell.figure) model.labels.set(cell.figure.id, { label: row.label, relabeled: false });
      }
    }
    return model;
  });
}

function continuesTable(previous: RawTable, next: RawTable) {
  if (next.blocks.some((block) => block.table!.header)) return false;
  if (next.firstOrdinal - previous.lastOrdinal > 6) return false;
  const labelsOf = (table: RawTable) =>
    new Map(
      table.blocks
        .filter((block) => block.table!.column > 0)
        .map((block) => [block.table!.column, block.table!.columnLabel ?? ""]),
    );
  const a = labelsOf(previous);
  const b = labelsOf(next);
  if (b.size === 0) return false;
  for (const [column, label] of b) {
    if (!label) return false;
    if (a.has(column) && a.get(column) !== label) return false;
  }
  const previousPage = previous.blocks[0]!.page;
  return previousPage === next.blocks[0]!.page;
}

/** Eine Spalte, die für jede Zeile genau Berichtsjahr minus Vorjahr ist, ist eine Veränderung. */
function markComputedChangeColumns(rows: TableRow[], columns: Map<number, TableColumn>) {
  const amountColumns = [...columns.values()].filter((column) => !column.percent);
  for (const target of amountColumns) {
    if (target.change) continue;
    for (const current of amountColumns) {
      if (current.index >= target.index || current.change) continue;
      for (const prior of amountColumns) {
        if (prior.index <= current.index || prior.index >= target.index || prior.change) continue;
        let checked = 0;
        let fits = true;
        for (const row of rows) {
          const c = row.cells.get(current.index)?.figure?.micro;
          const p = row.cells.get(prior.index)?.figure?.micro;
          const t = row.cells.get(target.index)?.figure;
          if (c == null || p == null || !t || t.micro === null) continue;
          checked += 1;
          if (
            compareWithTolerance(
              { micro: t.micro, displayUnit: t.displayUnit },
              { micro: c - p, displayUnit: t.displayUnit },
            ).status !== "match"
          ) {
            fits = false;
            break;
          }
        }
        if (
          fits &&
          checked >= 3 &&
          rows.some((row) => (row.cells.get(target.index)?.figure?.micro ?? 0n) !== 0n)
        ) {
          target.change = true;
        }
      }
    }
  }
}

/**
 * Anteilsspalten ohne Prozentzeichen (gbs Tz 61): eine Spalte, deren Summenzeile 100,0
 * zeigt und deren Werte alle höchstens 100 sind, ist ein Anteil und kein Betrag.
 */
function markShareColumns(rows: TableRow[], columns: Map<number, TableColumn>) {
  for (const column of columns.values()) {
    if (column.percent) continue;
    const figures = rows
      .map((row) => ({ row, figure: row.cells.get(column.index)?.figure }))
      .filter((entry) => entry.figure && entry.figure.micro !== null);
    if (figures.length < 3 || figures.some(({ figure }) => figure!.unit === "EUR")) continue;
    const hundred = 100_000_000n;
    const totalIsHundred = figures.some(
      ({ figure }) => figure!.micro === hundred && figure!.decimals === 1,
    );
    if (totalIsHundred && figures.every(({ figure }) => abs(figure!.micro!) <= hundred * 2n)) {
      const neighbour = columns.get(column.index - 1);
      if (neighbour && !neighbour.percent) column.percent = true;
    }
  }
}

/**
 * Die gröbste Darstellung der beteiligten Zahlen. Eine „0“ ohne Nachkommastellen sagt
 * nichts über die Genauigkeit und vergröbert die Toleranz nicht.
 */
function coarsestUnit(total: EngineFigure, components: readonly SeriesItem[]) {
  return components.reduce(
    (largest, item) =>
      item.figure.micro !== 0n && item.figure.displayUnit > largest
        ? item.figure.displayUnit
        : largest,
    total.displayUnit,
  );
}

function nonZero(components: readonly SeriesItem[]) {
  return Math.max(1, components.filter((item) => item.figure.micro !== 0n).length);
}

function amountOf(figure: EngineFigure) {
  return { micro: figure.micro!, displayUnit: figure.displayUnit };
}

const nonAmountColumn =
  /Nutzungsdauer|in Jahren|\bJahre\b|Anzahl|Stück|Mitarbeiter|Personen|Laufzeit in/iu;

export function isAmountColumn(column: TableColumn | undefined) {
  return Boolean(column) && !column!.percent && !nonAmountColumn.test(column!.label);
}

function sourceLabel(table: TableModel, row: TableRow, extra?: string) {
  return [
    table.page ? `Seite ${table.page}` : null,
    table.caption ? normalizeLabel(table.caption).slice(0, 60) : null,
    row.label || extra || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

type SeriesItem = { row: TableRow; figure: EngineFigure };

function sumDraft(
  table: TableModel,
  total: SeriesItem,
  components: SeriesItem[],
  options: { certain: boolean; signed?: bigint[]; kind?: "table_sum" },
): CheckDraft {
  const signs = options.signed ?? components.map(() => 1n);
  const expected = sum(components.map((item, index) => item.figure.micro! * signs[index]!));
  const unit = coarsestUnit(total.figure, components);
  const comparison = compareWithTolerance(
    { micro: total.figure.micro!, displayUnit: unit },
    { micro: expected, displayUnit: unit },
    nonZero(components),
  );
  const status =
    comparison.status === "match" ? "match" : options.certain ? "mismatch" : "uncertain";
  const reference = total.figure;
  return {
    kind: "table_sum",
    status,
    subjectFigureId: total.figure.id,
    subjectStatementId: null,
    actual: total.figure.micro,
    expected,
    tolerance: comparison.tolerance,
    rounded: comparison.rounded,
    sourceKind: "table",
    sourceFigureIds: components.map((item) => item.figure.id),
    sourceBlockIds: [],
    sourceLabel: sourceLabel(table, total.row),
    comment:
      status === "match"
        ? {
            code: "sum_matches",
            params: { count: String(components.length), rounded: comparison.rounded ? "1" : "0" },
          }
        : status === "mismatch"
          ? {
              code: "sum_differs",
              params: {
                difference: formatDifference(comparison.difference, reference),
                expected: formatAmount(expected, reference),
              },
            }
          : { code: "sum_ambiguous", params: {} },
    assignment: "rule",
    confidenceBp: null,
    sourceKey: `sum:${components.map((item) => item.figure.id).join(",")}`,
  };
}

function isExpenseRow(row: TableRow) {
  return expenseWord.test(row.label) && !/Erträge|Erstattung/iu.test(row.label.split("(")[0]!);
}

/** Vertikale Summen einer Tabelle. */
export function tableSumChecks(table: TableModel): CheckDraft[] {
  const drafts: CheckDraft[] = [];
  const amountColumns = [...table.columns.values()].filter(isAmountColumn);
  const staircase = staircaseLevels(table, amountColumns);
  if (staircase) {
    drafts.push(...staircaseChecks(table, staircase));
  } else {
    for (const column of amountColumns) {
      for (const series of seriesOf(table, column.index)) {
        drafts.push(...listChecks(table, series));
      }
    }
  }
  return drafts;
}

/** Zeilen einer Spalte; Klammerwerte bilden eine eigene Reihe (Vorjahr im Verbindlichkeitenspiegel). */
function seriesOf(table: TableModel, columnIndex: number): SeriesItem[][] {
  const plain: SeriesItem[] = [];
  const bracketed: SeriesItem[] = [];
  for (const row of table.rows) {
    const figure = row.cells.get(columnIndex)?.figure;
    if (!figure || figure.micro === null || figure.issue) continue;
    (figure.parenthesized && /^\(.*\)$/u.test(row.cells.get(columnIndex)!.text)
      ? bracketed
      : plain
    ).push({
      row,
      figure,
    });
  }
  return bracketed.length >= 2 && plain.length >= 2
    ? [plain, bracketed]
    : [[...plain, ...bracketed].sort((a, b) => a.row.index - b.row.index)];
}

type Staircase = {
  /** Spalten je Periode, von fein (Einzelposten) nach grob (Summe). */
  groups: Map<string, number[]>;
  rowLevel: Map<number, number>;
};

function staircaseLevels(table: TableModel, amountColumns: TableColumn[]): Staircase | null {
  const byPeriod = new Map<string, number[]>();
  for (const column of amountColumns) {
    if (column.change || column.period === null) continue;
    const key = column.period;
    const list = byPeriod.get(key) ?? [];
    list.push(column.index);
    byPeriod.set(key, list);
  }
  for (const list of byPeriod.values()) list.sort((a, b) => a - b);
  const rowLevel = new Map<number, number>();
  let found = false;
  for (const columnsOfPeriod of byPeriod.values()) {
    if (columnsOfPeriod.length < 2) continue;
    const used = columnsOfPeriod.filter(
      (index) =>
        table.rows.filter((row) => row.cells.get(index)?.figure?.micro != null).length >= 2,
    );
    if (used.length < 2) continue;
    // Beide Spalten müssen verschiedene Zeilen belegen: sonst sind es zwei Größen, keine Staffel.
    const [fine, coarse] = [used[used.length - 2]!, used[used.length - 1]!];
    const both = table.rows.filter(
      (row) => row.cells.get(fine)?.figure && row.cells.get(coarse)?.figure,
    ).length;
    if (both > 1) continue;
    found = true;
    for (const row of table.rows) {
      for (const [level, index] of used.entries()) {
        if (row.cells.get(index)?.figure?.micro != null) rowLevel.set(row.index, level);
      }
    }
  }
  if (!found) return null;
  const groups = new Map<string, number[]>();
  for (const [period, list] of byPeriod) groups.set(period, list);
  return { groups, rowLevel };
}

function staircaseChecks(table: TableModel, staircase: Staircase): CheckDraft[] {
  const drafts: CheckDraft[] = [];
  const consumed = new Set<string>();
  const { rowLevel } = staircase;

  for (const columnsOfPeriod of staircase.groups.values()) {
    // Mehrspaltige Periode: Ebene aus der Spalte. Einspaltige: Ebene der Zeile.
    const levelOf = (row: TableRow, columnIndex: number) =>
      columnsOfPeriod.length >= 2
        ? columnsOfPeriod.indexOf(columnIndex)
        : (rowLevel.get(row.index) ?? 0);
    const items: Array<SeriesItem & { level: number }> = [];
    for (const row of table.rows) {
      if (row.davon) continue;
      for (const index of columnsOfPeriod) {
        const figure = row.cells.get(index)?.figure;
        if (!figure || figure.micro === null || figure.issue) continue;
        const level = levelOf(row, index);
        if (level < 0) continue;
        items.push({ row, figure, level });
      }
    }
    // Summen nach ihren Posten: die Posten der nächstfeineren Ebene seit der letzten
    // Zahl gleicher oder höherer Ebene.
    for (const [position, item] of items.entries()) {
      if (item.level === 0) continue;
      let start = position - 1;
      while (start >= 0 && items[start]!.level < item.level) start -= 1;
      const window = items.slice(start + 1, position);
      const components = window.filter((entry) => entry.level === item.level - 1);
      if (components.length === 0) continue;
      if (!staircaseHeaderFits(table, item, components)) continue;
      // „3. Verbriefte Verbindlichkeiten 5.009.008,33“ vor „a) …“: der Oberposten steht vor
      // seinen Posten, die Zahl danach gehört zum nächsten Posten.
      const header = table.rows[components[0]!.row.index - 1];
      const headerFigure = header?.cells.get(columnOf(table, item.figure))?.figure;
      if (
        headerFigure &&
        headerFigure.micro !== null &&
        item.row.level !== null &&
        header!.level === item.row.level
      ) {
        const expected = sum(components.map((entry) => entry.figure.micro!));
        if (
          compareWithTolerance(
            amountOf(headerFigure),
            { micro: expected, displayUnit: headerFigure.displayUnit },
            components.length,
          ).status === "match"
        ) {
          drafts.push(
            sumDraft(table, { row: header!, figure: headerFigure }, components, { certain: true }),
          );
          for (const component of components) consumed.add(component.figure.id);
          continue;
        }
      }
      const signed = signsFor(item, components);
      drafts.push(
        sumDraft(table, item, components, {
          certain: signed === null,
          signed: signed ?? undefined,
        }),
      );
      for (const component of components) consumed.add(component.figure.id);
      relabelStaircaseSum(table, item, components);
    }
    // Summenzeilen („… insgesamt“, „Summe der Aktiva“) über Posten derselben Ebene.
    for (const [position, item] of items.entries()) {
      if (!totalWord.test(item.row.label) && !grandTotal.test(item.row.label)) continue;
      const header = grandTotal.test(item.row.label)
        ? sectionStart(table, item.row.index)
        : matchingHeader(table, item.row);
      const components = items
        .slice(0, position)
        .filter(
          (entry) =>
            entry.level === item.level &&
            entry.row.index > header &&
            !consumed.has(entry.figure.id),
        );
      if (components.length < 2) continue;
      drafts.push(sumDraft(table, item, components, { certain: true }));
      for (const component of components) consumed.add(component.figure.id);
    }
  }
  return drafts;
}

/**
 * Eine Summe nach ihren Posten braucht eine Überschrift über den Posten (gbs:
 * „B. Rückstellungen“ über 1. bis 3.) oder Geschwister als Posten („4.“ nach 1. bis 3.).
 * Stehen Unterposten ohne Überschrift am Anfang eines Tabellenteils, gehören sie zu
 * einem Oberposten davor (ICBC-Formblatt) — dann ist es keine Staffel.
 */
function columnOf(table: TableModel, figure: EngineFigure) {
  for (const row of table.rows) {
    for (const [index, cell] of row.cells) if (cell.figure?.id === figure.id) return index;
  }
  return -1;
}

function staircaseHeaderFits(table: TableModel, total: SeriesItem, components: SeriesItem[]) {
  const levels = components
    .map((component) => component.row.level)
    .filter((level): level is number => level !== null);
  // Posten einer Summe sind Geschwister; gemischte Ebenen („a)“, „aa)“) sind Unterposten.
  if (new Set(levels).size > 1) return false;
  if (total.row.level !== null && levels.includes(total.row.level)) return true;
  const header = table.rows[components[0]!.row.index - 1];
  if (!header) return false;
  if (header.level === null) return header.cells.size === 0 || levels.length === 0;
  return levels.length === 0 || header.level <= levels[0]!;
}

/**
 * GuV in Staffelform: Aufwendungen stehen ohne Minus. Eine Summe aus Erträgen und
 * Aufwendungen wird deshalb mit Vorzeichen gerechnet und bleibt bei Abweichung unsicher.
 */
function signsFor(total: SeriesItem, components: SeriesItem[]) {
  const expense = components.map((item) => isExpenseRow(item.row));
  if (expense.every((value) => !value) || expense.every((value) => value)) return null;
  const plain = sum(components.map((item) => item.figure.micro!));
  if (
    compareWithTolerance(
      amountOf(total.figure),
      { micro: plain, displayUnit: total.figure.displayUnit },
      components.length,
    ).status === "match"
  ) {
    return null;
  }
  return components.map((item) => (isExpenseRow(item.row) ? -1n : 1n));
}

/**
 * Der Konverter setzt eine Summe der Staffelform oft in die Zeile des nächsten Abschnitts
 * („C. Verbindlichkeiten 4.749.835,08“ ist die Summe der Rückstellungen). Das Label der
 * Summe ist dann die Überschrift über ihren Posten.
 */
function relabelStaircaseSum(table: TableModel, total: SeriesItem, components: SeriesItem[]) {
  if (components.length < 2 || totalWord.test(total.row.label)) return;
  const firstRow = components[0]!.row.index;
  const header = table.rows[firstRow - 1];
  const own = total.row;
  // „4. Materialaufwand“ als Zeile der Summe von 1. bis 3.: das eigene Label gehört zur
  // nächsten Position, die Summe ist eine Zwischensumme.
  if (own.level !== null && components.some((component) => component.row.level === own.level)) {
    table.labels.set(total.figure.id, { label: "Zwischensumme", relabeled: true });
    return;
  }
  if (!header || !header.label || header.level === null) return;
  const inside = table.rows.slice(firstRow, total.row.index + 1);
  if (inside.some((row) => row !== total.row && row.level !== null && row.level <= header.level!))
    return;
  const ownIsNextHeader = own.level !== null && own.level <= header.level && own !== header;
  if (own.label && !ownIsNextHeader) return;
  table.labels.set(total.figure.id, { label: header.label, relabeled: true });
}

function sectionStart(table: TableModel, rowIndex: number) {
  for (let index = rowIndex - 1; index >= 0; index -= 1) {
    if (sectionHeader.test(table.rows[index]!.label)) return index;
  }
  return -1;
}

/** „Anlagevermögen insgesamt“ gehört zur Überschrift „A. Anlagevermögen“. */
function matchingHeader(table: TableModel, row: TableRow) {
  const name = row.label
    .replace(/\s*insgesamt$/iu, "")
    .trim()
    .toLowerCase();
  for (let index = row.index - 1; index >= 0; index -= 1) {
    const candidate = table.rows[index]!;
    if (candidate.label.toLowerCase() === name && candidate.cells.size === 0) return index;
  }
  return sectionStart(table, row.index);
}

/** Gliederung mit Unterposten und einfache Listen einer Spalte. */
function listChecks(table: TableModel, series: SeriesItem[]): CheckDraft[] {
  const drafts: CheckDraft[] = [];
  if (looksLikePageNumbers(series)) return drafts;
  const items = series.filter((item) => !item.row.davon);
  const consumed = new Set<string>();

  // 1. Unterposten: „3. Forderungen … 234.414.817,04“ = a) + b).
  for (const [position, parent] of items.entries()) {
    const level = parent.row.level;
    // Nur „3. …“ vor „a) b)“: römische Zeilen der GuV sind Ergebniszeilen nach ihren Posten.
    if (level === null || level < 3 || resultWord.test(parent.row.label)) continue;
    const children: SeriesItem[] = [];
    let childLevel: number | null = null;
    for (const next of items.slice(position + 1)) {
      const nextLevel = next.row.level;
      if (nextLevel === null || nextLevel <= level || totalWord.test(next.row.label)) break;
      childLevel ??= nextLevel;
      if (nextLevel === childLevel) children.push(next);
    }
    // Zeilen ohne Zahl zwischen den Unterposten zählen mit: sie müssen ebenfalls Unterposten sein.
    const between = table.rows.slice(
      parent.row.index + 1,
      (children.at(-1)?.row.index ?? parent.row.index) + 1,
    );
    if (
      children.length === 0 ||
      between.some((row) => !row.davon && row.level !== null && row.level <= level)
    )
      continue;
    drafts.push(sumDraft(table, parent, children, { certain: children.length >= 2 }));
    for (const child of children) consumed.add(child.figure.id);
  }

  // 2. Zwischensummen ohne Summenwort und GuV-Ergebniszeilen: nur bestätigend.
  const stack: SeriesItem[] = [];
  let lastResult: SeriesItem | null = null;
  const resultAnchors: SeriesItem[] = [];
  for (const item of items) {
    if (consumed.has(item.figure.id) && item.row.level !== null && item.row.level >= 4) continue;
    if (sectionHeaderBefore(table, item, stack)) stack.length = 0;
    const labelTotal = totalWord.test(item.row.label) || grandTotal.test(item.row.label);
    if (labelTotal) {
      const components = stack.filter((entry) => !consumed.has(entry.figure.id));
      const top = Math.min(...components.map((entry) => entry.row.level ?? 99));
      const enumerated = top < 99;
      const chosen = enumerated
        ? components.filter((entry) => entry.row.level === top)
        : components;
      if (chosen.length >= 2) {
        const clean =
          chosen.length <= 12 &&
          (enumerated
            ? startsAtOne(chosen[0]!.row.rawLabel) || sectionStart(table, item.row.index) >= 0
            : chosen.every((entry) => entry.row.label.length > 0));
        drafts.push(sumDraft(table, item, chosen, { certain: clean }));
        for (const entry of chosen) consumed.add(entry.figure.id);
      }
      stack.length = 0;
      stack.push(item);
      continue;
    }
    if (resultWord.test(item.row.label) && stack.length > 0) {
      const draft = resultDraft(table, item, stack, lastResult, resultAnchors);
      if (draft) {
        drafts.push(draft.check);
        for (const id of draft.consumed) consumed.add(id);
        lastResult = item;
        resultAnchors.push(item);
        stack.push(item);
        continue;
      }
    }
    const discovered = discoverSubtotal(
      item,
      stack.filter((entry) => !consumed.has(entry.figure.id)),
    );
    if (discovered) {
      drafts.push(sumDraft(table, item, discovered, { certain: false }));
      for (const entry of discovered) consumed.add(entry.figure.id);
    }
    stack.push(item);
  }
  return drafts;
}

/** Eine Gliederung beginnt bei „1.“, „A.“ oder „I.“; sonst fehlt ein Teil der Tabelle. */
function startsAtOne(rawLabel: string) {
  return /^(?:1[a-z]?\.|A\.|I\.|a\))\s/u.test(rawLabel.trim());
}

/** Inhaltsverzeichnis: aufsteigende ganze Zahlen ohne Einheit sind Seitenzahlen. */
function looksLikePageNumbers(series: SeriesItem[]) {
  if (series.length < 5) return false;
  let last = -1n;
  for (const { figure } of series) {
    if (figure.unit !== "unknown" || figure.decimals !== 0 || figure.micro! >= 1_000_000_000n)
      return false;
    if (figure.micro! < last) return false;
    last = figure.micro!;
  }
  return true;
}

function sectionHeaderBefore(table: TableModel, item: SeriesItem, stack: SeriesItem[]) {
  const previous = stack.at(-1);
  const from = previous ? previous.row.index + 1 : 0;
  return table.rows.slice(from, item.row.index).some((row) => sectionHeader.test(row.label));
}

/** Kürzeste Folge unmittelbar vorangehender Posten, deren Summe die Zahl ergibt. */
function discoverSubtotal(item: SeriesItem, stack: SeriesItem[]) {
  for (let length = 2; length <= Math.min(stack.length, 12); length += 1) {
    const components = stack.slice(-length);
    const expected = sum(components.map((entry) => entry.figure.micro!));
    const unit = components.reduce(
      (largest, entry) => (entry.figure.displayUnit > largest ? entry.figure.displayUnit : largest),
      item.figure.displayUnit,
    );
    const comparison = compareWithTolerance(
      { micro: item.figure.micro!, displayUnit: unit },
      { micro: expected, displayUnit: unit },
      length,
    );
    if (comparison.status === "match" && abs(item.figure.micro!) > comparison.tolerance * 2n) {
      return components;
    }
  }
  return null;
}

/**
 * GuV-Ergebniszeilen („Rohertrag“, „IV. BETRIEBSERGEBNIS“): kumulativ ab der letzten
 * Ergebniszeile, nur über die Posten seitdem oder als Summe zweier Ergebniszeilen —
 * mit und ohne Vorzeichen der Aufwendungen. Passt keine Lesart, bleibt es grau.
 */
function resultDraft(
  table: TableModel,
  item: SeriesItem,
  stack: SeriesItem[],
  lastResult: SeriesItem | null,
  anchors: SeriesItem[],
) {
  const since = lastResult ? stack.slice(stack.indexOf(lastResult) + 1) : stack;
  const direct = since.filter((entry) => entry.row.level === null || entry.row.level <= 3);
  const variants: SeriesItem[][] = [];
  if (lastResult && direct.length >= 1) variants.push([lastResult, ...direct]);
  if (direct.length >= 2) variants.push(direct);
  if (anchors.length >= 2) variants.push(anchors.slice(-2));
  for (const components of variants) {
    for (const signed of [false, true]) {
      const signs = components.map((entry) =>
        signed && isExpenseRow(entry.row) && entry !== lastResult ? -1n : 1n,
      );
      const expected = sum(components.map((entry, index) => entry.figure.micro! * signs[index]!));
      const comparison = compareWithTolerance(
        { micro: item.figure.micro!, displayUnit: item.figure.displayUnit },
        { micro: expected, displayUnit: item.figure.displayUnit },
        components.length,
      );
      if (comparison.status === "match") {
        return {
          check: sumDraft(table, item, components, { certain: false, signed: signs }),
          consumed: components.map((entry) => entry.figure.id),
        };
      }
    }
  }
  return null;
}

/** „Gesamt“-Spalten: Summe der gleichperiodigen Spalten der anderen Gruppen. */
export function horizontalChecks(table: TableModel): CheckDraft[] {
  const drafts: CheckDraft[] = [];
  const columns = [...table.columns.values()];
  const totals = columns.filter(
    (column) => /^(?:Gesamt|Summe|Insgesamt|Total)$/iu.test(column.group) && !column.percent,
  );
  for (const total of totals) {
    const parts = columns.filter(
      (column) =>
        column.index !== total.index &&
        column.group !== total.group &&
        column.period === total.period &&
        !column.percent &&
        !column.change,
    );
    if (parts.length < 2) continue;
    for (const [rowPosition, row] of table.rows.entries()) {
      const totalFigure = row.cells.get(total.index)?.figure;
      if (!totalFigure || totalFigure.micro === null) continue;
      const next = table.rows[rowPosition + 1];
      const continued = Boolean(next && /^\p{Ll}/u.test(next.rawLabel));
      const components: SeriesItem[] = [];
      let incomplete = continued;
      for (const part of parts) {
        const cell = row.cells.get(part.index);
        if (cell?.figure && cell.figure.micro !== null && !cell.figure.issue) {
          components.push({ row, figure: cell.figure });
        } else if (!cell || !/^[-–]$/u.test(cell.text)) {
          incomplete = true;
        }
      }
      const reference = totalFigure;
      if (incomplete || components.length < 2) {
        drafts.push({
          kind: "horizontal_sum",
          status: "uncertain",
          subjectFigureId: totalFigure.id,
          subjectStatementId: null,
          actual: totalFigure.micro,
          expected: null,
          tolerance: null,
          rounded: false,
          sourceKind: "table",
          sourceFigureIds: components.map((item) => item.figure.id),
          sourceBlockIds: [],
          sourceLabel: sourceLabel(table, row, total.label),
          comment: { code: "horizontal_incomplete", params: {} },
          assignment: "rule",
          confidenceBp: null,
          sourceKey: `horizontal:${total.index}`,
        });
        continue;
      }
      const expected = sum(components.map((item) => item.figure.micro!));
      const unit = coarsestUnit(totalFigure, components);
      const comparison = compareWithTolerance(
        { micro: totalFigure.micro, displayUnit: unit },
        { micro: expected, displayUnit: unit },
        nonZero(components),
      );
      drafts.push({
        kind: "horizontal_sum",
        status: comparison.status,
        subjectFigureId: totalFigure.id,
        subjectStatementId: null,
        actual: totalFigure.micro,
        expected,
        tolerance: comparison.tolerance,
        rounded: comparison.rounded,
        sourceKind: "table",
        sourceFigureIds: components.map((item) => item.figure.id),
        sourceBlockIds: [],
        sourceLabel: sourceLabel(table, row, total.label),
        comment:
          comparison.status === "match"
            ? {
                code: "horizontal_matches",
                params: {
                  count: String(components.length),
                  rounded: comparison.rounded ? "1" : "0",
                },
              }
            : {
                code: "horizontal_differs",
                params: {
                  count: String(components.length),
                  difference: formatDifference(comparison.difference, reference),
                  expected: formatAmount(expected, reference),
                },
              },
        assignment: "rule",
        confidenceBp: null,
        sourceKey: `horizontal:${total.index}`,
      });
    }
  }
  return drafts;
}

/** Veränderungsspalten: Berichtsjahr minus Vorjahr derselben Größe. */
export function changeColumnChecks(table: TableModel): CheckDraft[] {
  const drafts: CheckDraft[] = [];
  const columns = [...table.columns.values()].filter((column) => !column.percent);
  const changes = columns.filter((column) => column.change);
  const current = columns.find((column) => column.period === "current" && !column.change);
  const prior = columns.find((column) => column.period === "prior" && !column.change);
  if (!current || !prior) return drafts;
  for (const change of changes) {
    // Eine beschriftete Veränderungsspalte, die überwiegend nicht aufgeht, ist eine
    // Prozentspalte ohne Prozentzeichen (gbs Tz 61) und bleibt ungeprüft.
    let fits = 0;
    let rowsWithValues = 0;
    for (const row of table.rows) {
      const target = row.cells.get(change.index)?.figure;
      const c = row.cells.get(current.index)?.figure;
      const p = row.cells.get(prior.index)?.figure;
      if (!target || target.micro === null || !c || !p || c.micro === null || p.micro === null)
        continue;
      if (target.micro === 0n && c.micro === p.micro) continue;
      rowsWithValues += 1;
      const unit = [target.displayUnit, c.displayUnit, p.displayUnit].reduce((a, b) =>
        a > b ? a : b,
      );
      if (
        compareWithTolerance(
          { micro: target.micro, displayUnit: unit },
          { micro: c.micro - p.micro, displayUnit: unit },
          2,
        ).status === "match"
      )
        fits += 1;
    }
    if (rowsWithValues === 0 || fits * 2 <= rowsWithValues) continue;
    for (const row of table.rows) {
      const target = row.cells.get(change.index)?.figure;
      const c = row.cells.get(current.index)?.figure;
      const p = row.cells.get(prior.index)?.figure;
      if (!target || !c || !p || target.micro === null || c.micro === null || p.micro === null)
        continue;
      const expected = c.micro - p.micro;
      const unit = [target.displayUnit, c.displayUnit, p.displayUnit].reduce((a, b) =>
        a > b ? a : b,
      );
      const comparison = compareWithTolerance(
        { micro: target.micro, displayUnit: unit },
        { micro: expected, displayUnit: unit },
        2,
      );
      drafts.push({
        kind: "change_column",
        status: comparison.status,
        subjectFigureId: target.id,
        subjectStatementId: null,
        actual: target.micro,
        expected,
        tolerance: comparison.tolerance,
        rounded: comparison.rounded,
        sourceKind: "table",
        sourceFigureIds: [c.id, p.id],
        sourceBlockIds: [],
        sourceLabel: sourceLabel(table, row, change.label),
        comment:
          comparison.status === "match"
            ? { code: "change_matches", params: { rounded: comparison.rounded ? "1" : "0" } }
            : {
                code: "change_differs",
                params: {
                  difference: formatDifference(comparison.difference, target),
                  expected: formatAmount(expected, target),
                },
              },
        assignment: "rule",
        confidenceBp: null,
        sourceKey: `change:${c.id}:${p.id}`,
      });
    }
  }
  return drafts;
}

/** Aktiva = Passiva: jede Passiva-Summe gegen die vorangehende Aktiva-Summe derselben Periode. */
export function balanceChecks(tables: readonly TableModel[]): CheckDraft[] {
  type Total = {
    side: "assets" | "liabilities";
    figure: EngineFigure;
    table: TableModel;
    row: TableRow;
  };
  const totals: Total[] = [];
  for (const table of tables) {
    let side: Total["side"] | null = null;
    for (const row of table.rows) {
      if (/^Aktiva$/iu.test(row.label)) side = "assets";
      if (/^Passiva$/iu.test(row.label)) side = "liabilities";
      const explicit = /^Summe (?:der )?Aktiva$/iu.test(row.label)
        ? "assets"
        : /^Summe (?:der )?Passiva$/iu.test(row.label)
          ? "liabilities"
          : /^Bilanzsumme$/iu.test(row.label)
            ? side
            : null;
      if (!explicit) continue;
      for (const cell of row.cells.values()) {
        const column = table.columns.get(
          [...row.cells.entries()].find(([, value]) => value === cell)![0],
        );
        if (!cell.figure || cell.figure.micro === null || column?.percent) continue;
        totals.push({ side: explicit, figure: cell.figure, table, row });
      }
    }
  }
  const drafts: CheckDraft[] = [];
  for (const [position, liabilities] of totals.entries()) {
    if (liabilities.side !== "liabilities") continue;
    const assets = totals
      .slice(0, position)
      .reverse()
      .find(
        (entry) =>
          entry.side === "assets" &&
          entry.figure.period === liabilities.figure.period &&
          entry.figure.scale === liabilities.figure.scale,
      );
    if (!assets) continue;
    const comparison = compareWithTolerance(amountOf(liabilities.figure), amountOf(assets.figure));
    drafts.push({
      kind: "balance",
      status: comparison.status,
      subjectFigureId: liabilities.figure.id,
      subjectStatementId: null,
      actual: liabilities.figure.micro,
      expected: assets.figure.micro,
      tolerance: comparison.tolerance,
      rounded: comparison.rounded,
      sourceKind: "table",
      sourceFigureIds: [assets.figure.id],
      sourceBlockIds: [],
      sourceLabel: sourceLabel(assets.table, assets.row),
      comment:
        comparison.status === "match"
          ? { code: "balance_matches", params: { rounded: comparison.rounded ? "1" : "0" } }
          : {
              code: "balance_differs",
              params: { difference: formatDifference(comparison.difference, liabilities.figure) },
            },
      assignment: "rule",
      confidenceBp: null,
      sourceKey: `balance:${assets.figure.id}`,
    });
  }
  return drafts;
}
