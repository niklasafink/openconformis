import { abs, compareWithTolerance, microPerUnit, ratioPercentMicro } from "../arithmetic";
import type { PeriodHint } from "../figures";

import { normalizeLabel, postenByKey, postenOfRowLabel, type Posten } from "./posten";
import { isAmountColumn, type TableModel, type TableRow } from "./tables";
import type { EngineFigure } from "./types";

/**
 * Was die Tabellen über einen Posten sagen: je Posten und Periode alle Zahlen, die ihn
 * zeigen, und abgeleitete Werte aus Code-Formeln. Ein Posten ist eindeutig, wenn alle
 * Zahlen außerhalb abweichend gegliederter Tabellen im Rahmen der Rundung übereinstimmen.
 */

export type Fact = {
  figure: EngineFigure;
  table: TableModel;
  row: TableRow;
  /** Summenzeile, deren Posten aus der Tabellenüberschrift stammt („Summe“ unter „9. Sonstige …“). */
  viaCaption: boolean;
  label: string;
  relabeled: boolean;
  posten: Posten | null;
  period: PeriodHint;
  /** Die Zahl ist durch eine stimmende Summe bestätigt. */
  confirmed: boolean;
  /** Anzahl gerundeter Summanden der bestätigten Summe (Toleranz × n). */
  terms: number;
};

export type Resolved = {
  key: string;
  label: string;
  period: PeriodHint;
  micro: bigint;
  displayUnit: bigint;
  /** Zahlen, aus denen der Wert stammt (Tabellen) bzw. die Operanden einer Formel. */
  sources: EngineFigure[];
  sourceLabel: string;
  formula: string | null;
  /** Alle Kandidaten stimmen überein. */
  consistent: boolean;
  candidates: Fact[];
  /** Nur Zahlen abweichend gegliederter Tabellen. */
  alternateOnly: boolean;
  relabeled: boolean;
};

export type FactIndex = {
  byPosten: Map<string, Fact[]>;
  facts: Fact[];
};

function captionPosten(table: TableModel) {
  if (!table.caption) return null;
  const caption = normalizeLabel(table.caption);
  return (
    postenOfRowLabel(caption) ??
    [...postenByKey.values()].find((posten) => posten.text.test(caption)) ??
    null
  );
}

export function buildFacts(
  tables: readonly TableModel[],
  confirmed: ReadonlyMap<string, number>,
): FactIndex {
  const facts: Fact[] = [];
  for (const table of tables) {
    const tablePosten = captionPosten(table);
    // Spaltengruppen wie Regionen: nur die Gesamtspalte zeigt den Posten.
    const groups = new Set(
      [...table.columns.values()].map((column) => column.group).filter(Boolean),
    );
    const totalGroup = [...groups].find((group) =>
      /^(?:Gesamt|Summe|Insgesamt|Total)$/iu.test(group),
    );
    const groupsByPeriod = new Map<string, Set<string>>();
    for (const column of table.columns.values()) {
      if (!column.period || column.change || column.percent || !column.group) continue;
      const set = groupsByPeriod.get(column.period) ?? new Set<string>();
      set.add(column.group);
      groupsByPeriod.set(column.period, set);
    }
    const regional = [...groupsByPeriod.values()].some((set) => set.size > 1);
    for (const row of table.rows) {
      for (const [columnIndex, cell] of row.cells) {
        const figure = cell.figure;
        const column = table.columns.get(columnIndex);
        if (!figure || figure.micro === null || figure.issue || !column) continue;
        if (!isAmountColumn(column) || column.change || row.davon) continue;
        if (regional && column.group !== totalGroup) continue;
        if (figure.unit !== "EUR" && figure.unit !== "percent") continue;
        const period = figure.period ?? column.period;
        if (period !== "current" && period !== "prior") continue;
        const effective = table.labels.get(figure.id) ?? { label: row.label, relabeled: false };
        const summe = /^(?:Summe|Gesamt|Insgesamt)$/iu.test(effective.label);
        const posten = summe ? tablePosten : postenOfRowLabel(effective.label);
        facts.push({
          figure,
          table,
          row,
          viaCaption: summe && tablePosten !== null,
          label: summe && tablePosten ? tablePosten.label : effective.label,
          relabeled: effective.relabeled,
          posten,
          period,
          confirmed: confirmed.has(figure.id),
          terms: confirmed.get(figure.id) ?? 1,
        });
      }
    }
  }
  const byPosten = new Map<string, Fact[]>();
  for (const fact of facts) {
    const key = fact.posten?.key ?? `label:${fact.label.toLowerCase()}`;
    const list = byPosten.get(key) ?? [];
    list.push(fact);
    byPosten.set(key, list);
  }
  return { byPosten, facts };
}

export function agree(
  a: { micro: bigint; displayUnit: bigint },
  b: { micro: bigint; displayUnit: bigint },
  magnitude = false,
) {
  const left = magnitude ? { ...a, micro: abs(a.micro) } : a;
  const right = magnitude ? { ...b, micro: abs(b.micro) } : b;
  return compareWithTolerance(left, right).status === "match";
}

export function factSourceLabel(fact: Fact) {
  return [
    fact.table.page ? `Seite ${fact.table.page}` : null,
    fact.label,
    fact.period === "prior" ? "Vorjahr" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function magnitudeCompare(posten: Posten | null) {
  return posten?.kind === "expense";
}

/** Tabellenwert eines Postens; bevorzugt die genaueste Zahl. */
export function resolveFromTables(
  index: FactIndex,
  key: string,
  period: PeriodHint,
): Resolved | null {
  const all = (index.byPosten.get(key) ?? []).filter(
    (fact) => fact.period === period && fact.figure.unit === "EUR",
  );
  if (all.length === 0) return null;
  const primary = all.filter((fact) => !fact.table.alternate);
  let candidates = primary.length > 0 ? primary : all;
  // Summen unter einer Überschrift sind schwächer als ein Zeilenlabel: widersprechen sie, zählen sie nicht.
  const labelled = candidates.filter((fact) => !fact.viaCaption);
  if (labelled.length > 0 && labelled.length < candidates.length) candidates = labelled;
  const posten = postenByKey.get(key) ?? null;
  const sorted = [...candidates].sort(
    (a, b) =>
      Number(a.relabeled) - Number(b.relabeled) ||
      (a.figure.displayUnit < b.figure.displayUnit
        ? -1
        : a.figure.displayUnit > b.figure.displayUnit
          ? 1
          : 0) ||
      Number(b.confirmed) - Number(a.confirmed),
  );
  const best = sorted[0]!;
  const consistent = candidates.every((fact) =>
    agree(
      { micro: fact.figure.micro!, displayUnit: fact.figure.displayUnit },
      { micro: best.figure.micro!, displayUnit: best.figure.displayUnit },
      magnitudeCompare(posten),
    ),
  );
  return {
    key,
    label: posten?.label ?? best.label,
    period,
    micro: best.figure.micro!,
    displayUnit: best.figure.displayUnit,
    sources: [best.figure],
    sourceLabel: factSourceLabel(best),
    formula: null,
    consistent,
    candidates,
    alternateOnly: primary.length === 0,
    relabeled: best.relabeled,
  };
}

type Formula = {
  key: string;
  label: string;
  unit: "EUR" | "percent";
  compute: (
    value: (key: string) => Resolved | null,
  ) => { micro: bigint; displayUnit: bigint; sources: EngineFigure[]; formula: string } | null;
};

/**
 * Operand einer Formel: die genaueste Zahl des Postens. Widersprechen sich zwei Tabellen,
 * meldet das ihr eigener Querverweis; die Formel rechnet mit der genaueren Zahl.
 */
function operand(value: (key: string) => Resolved | null, key: string) {
  const resolved = value(key);
  return resolved && !resolved.alternateOnly ? resolved : null;
}

function larger(a: bigint, b: bigint) {
  return a > b ? a : b;
}

/** Share of a posten in the balance sheet total, in micro percentage points. */
function share(value: (key: string) => Resolved | null, key: string, label: string) {
  const numerator = operand(value, key);
  const total = operand(value, "bilanzsumme");
  if (!numerator || !total) return null;
  const ratio = ratioPercentMicro(numerator.micro, total.micro);
  if (ratio === null) return null;
  return {
    micro: ratio,
    // Eine Quote aus zwei gerundeten Beträgen ist auf ihre letzte Stelle genau.
    displayUnit: 10_000n,
    sources: [...numerator.sources, ...total.sources],
    formula: `${label} / Bilanzsumme`,
  };
}

export const formulas: readonly Formula[] = [
  {
    key: "fremdkapital",
    label: "Fremdkapital",
    unit: "EUR",
    compute: (value) => {
      const total = operand(value, "bilanzsumme");
      const equity = operand(value, "eigenkapital");
      if (!total || !equity) return null;
      return {
        micro: total.micro - equity.micro,
        displayUnit: larger(total.displayUnit, equity.displayUnit),
        sources: [...total.sources, ...equity.sources],
        formula: "Bilanzsumme − Eigenkapital",
      };
    },
  },
  {
    key: "eigenkapitalquote",
    label: "Eigenkapitalquote",
    unit: "percent",
    compute: (value) => share(value, "eigenkapital", "Eigenkapital"),
  },
  {
    key: "fremdkapitalquote",
    label: "Fremdkapitalquote",
    unit: "percent",
    compute: (value) => share(value, "fremdkapital", "Fremdkapital"),
  },
  {
    key: "nettozinsertrag",
    label: "Nettozinsertrag",
    unit: "EUR",
    compute: (value) => {
      const income = operand(value, "zinsertraege");
      const expense = operand(value, "zinsaufwendungen");
      if (!income || !expense) return null;
      return {
        micro: abs(income.micro) - abs(expense.micro),
        displayUnit: larger(income.displayUnit, expense.displayUnit),
        sources: [...income.sources, ...expense.sources],
        formula: "Zinserträge − Zinsaufwendungen",
      };
    },
  },
  {
    key: "provisionsergebnis",
    label: "Provisionsergebnis",
    unit: "EUR",
    compute: (value) => {
      const income = operand(value, "provisionsertraege");
      const expense = operand(value, "provisionsaufwendungen");
      if (!income || !expense) return null;
      return {
        micro: abs(income.micro) - abs(expense.micro),
        displayUnit: larger(income.displayUnit, expense.displayUnit),
        sources: [...income.sources, ...expense.sources],
        formula: "Provisionserträge − Provisionsaufwendungen",
      };
    },
  },
];

export const formulaByKey = new Map(formulas.map((formula) => [formula.key, formula]));

/**
 * Wert eines Postens je Periode: aus den Tabellen, sonst aus einer Code-Formel. Für
 * Anteile („Rückstellungen mit 70 %“) liefert `shareOf` den Anteil an der Bilanzsumme.
 */
export function createResolver(index: FactIndex) {
  const cache = new Map<string, Resolved | null>();
  function resolve(key: string, period: PeriodHint): Resolved | null {
    const cacheKey = `${key}:${period}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;
    cache.set(cacheKey, null);
    const fromTables = resolveFromTables(index, key, period);
    let result: Resolved | null = fromTables;
    if (!result) {
      const formula = formulaByKey.get(key);
      const computed = formula?.compute((operandKey) => resolve(operandKey, period));
      if (formula && computed) {
        result = {
          key,
          label: formula.label,
          period,
          micro: computed.micro,
          displayUnit: computed.displayUnit,
          sources: computed.sources,
          sourceLabel: computed.formula,
          formula: computed.formula,
          consistent: true,
          candidates: [],
          alternateOnly: false,
          relabeled: false,
        };
      }
    }
    cache.set(cacheKey, result);
    return result;
  }
  function shareOf(key: string, period: PeriodHint): Resolved | null {
    const posten = postenByKey.get(key);
    if (!posten) return null;
    const computed = share((operandKey) => resolve(operandKey, period), key, posten.label);
    if (!computed) return null;
    return {
      key: `share:${key}`,
      label: `Anteil ${posten.label}`,
      period,
      micro: computed.micro,
      displayUnit: computed.displayUnit,
      sources: computed.sources,
      sourceLabel: computed.formula,
      formula: computed.formula,
      consistent: true,
      candidates: [],
      alternateOnly: false,
      relabeled: false,
    };
  }
  return { resolve, shareOf };
}

export type Resolver = ReturnType<typeof createResolver>;

/** 1 Prozentpunkt in Mikroeinheiten, für Anzeige von Quoten. */
export const percentPoint = microPerUnit;
