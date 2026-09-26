import { describe, expect, it } from "vitest";

import { deriveDocumentContext, type ContextInputBlock } from "../document-context";
import { recognizeFigures } from "../figures";
import { recognizeYears } from "../years";

import { renderComment } from "./comments";
import { runDeterministicChecks } from "./run";
import type { EngineBlock, EngineDocument, EngineFigure, EngineYear } from "./types";

/**
 * Vortrag gegen den Vorjahresbericht an Auszügen des echten Paars ICBC 2024 → 2025:
 * stehen gebliebene Jahreszahlen im Fließtext und Vorjahreswerte der Tabellen.
 */

type Spec = { text: string } | { table: number; cells: Array<Array<string | null>> };

function buildDocument(prefix: string, stichtag: string, specs: Spec[]): EngineDocument {
  const inputs: ContextInputBlock[] = [
    { id: `${prefix}year`, blockType: "paragraph", text: `Jahresabschluss zum ${stichtag}` },
  ];
  for (const [index, spec] of specs.entries()) {
    if ("text" in spec) {
      inputs.push({ id: `${prefix}p${index}`, blockType: "paragraph", text: spec.text });
      continue;
    }
    spec.cells.forEach((row, rowIndex) =>
      row.forEach((text, column) => {
        if (text === null) return;
        inputs.push({
          id: `${prefix}t${spec.table}r${rowIndex}c${column}`,
          blockType: "table_cell",
          text,
          cell: { table: spec.table, row: rowIndex, column, header: rowIndex === 0 },
        });
      }),
    );
  }
  const { reportYear, contexts } = deriveDocumentContext(inputs);
  const blocks: EngineBlock[] = [];
  const figures: EngineFigure[] = [];
  const years: EngineYear[] = [];
  inputs.forEach((input, ordinal) => {
    const context = contexts.get(input.id)!;
    const table = context.table;
    blocks.push({
      id: input.id,
      ordinal,
      type: input.blockType,
      text: input.text,
      page: 3,
      tz: null,
      technical: context.technical,
      table: table
        ? {
            index: table.index,
            row: table.row,
            column: table.column,
            header: table.header,
            rowLabel: table.rowLabel,
            columnLabel: table.columnInfo?.label ?? null,
            caption: table.caption,
          }
        : null,
    });
    recognizeYears(input.text, input.blockType).forEach((year, index) =>
      years.push({ id: `${input.id}:y${index}`, blockId: input.id, ...year }),
    );
    if (table?.header || (table && table.column === 0)) return;
    const column = table?.columnInfo;
    recognizeFigures(input.text, {
      blockType: input.blockType,
      reportYear,
      columnUnit: column?.unit && column.scale ? { unit: column.unit, scale: column.scale } : null,
      columnPeriod: column?.period ?? null,
    }).forEach((figure, index) =>
      figures.push({
        id: `${input.id}:${index}`,
        blockId: input.id,
        start: figure.start,
        end: figure.end,
        raw: figure.raw,
        micro: figure.micro,
        displayUnit: figure.displayUnit,
        unit: figure.unit,
        scale: figure.scale,
        decimals: figure.decimals,
        period: figure.periodHint,
        parenthesized: figure.parenthesized,
        issue: figure.issue,
      }),
    );
  });
  return { blocks, figures, statements: [], years, reportYear };
}

function priorChecks(current: EngineDocument, prior: EngineDocument | null = null) {
  const { drafts } = runDeterministicChecks(current, [], prior);
  const years = new Map((current.years ?? []).map((year) => [year.id, year]));
  const figures = new Map(current.figures.map((figure) => [figure.id, figure]));
  return drafts
    .filter((draft) => draft.kind === "rollover" || draft.kind === "prior_report")
    .map((draft) => ({
      ...draft,
      subject: draft.subjectStatementId
        ? `${years.get(draft.subjectStatementId)!.raw}@${years.get(draft.subjectStatementId)!.blockId}`
        : figures.get(draft.subjectFigureId!)!.raw,
    }));
}

const balance2025 = {
  table: 1,
  cells: [
    [null, "31.12.2025 in EUR", "31.12.2024 in EUR"],
    ["Forderungen an Kunden", "402.705.113,20", "395.356.783,11"],
    ["Sonstige Vermögensgegenstände", "774.491,78", "110.310,00"],
  ],
};
const balance2024 = {
  table: 1,
  cells: [
    [null, "31.12.2024 in EUR", "31.12.2023 in EUR"],
    ["Forderungen an Kunden", "395.356.783,11", "402.117.905,50"],
    ["Sonstige Vermögensgegenstände", "110.310,00", "97.114,23"],
  ],
};

describe("Jahreszahlen im Fließtext", () => {
  it("findet Jahre, aber keine Normzitate und keine Tabellenzellen", () => {
    const text =
      "Nach Art. 92 der Verordnung (EU) Nr. 575/2013 und der Verordnung (EU) 2024/1623 gilt ab 2026 der Standardansatz; im Geschäftsjahr 2025 wurde er vorbereitet.";
    expect(recognizeYears(text, "paragraph").map((year) => year.raw)).toEqual(["2026", "2025"]);
    expect(recognizeYears("31.12.2024", "table_cell")).toEqual([]);
  });
});

describe("Vortrag: Jahreszahl nicht fortgeschrieben", () => {
  it("meldet ohne Vorjahresbericht ein altes Jahr in einer Stichtagsformel als Verdacht", () => {
    const current = buildDocument("c", "31. Dezember 2025", [
      { text: "Wir haben den Jahresabschluss zum 31. Dezember 2024 geprüft." },
    ]);
    const [check] = priorChecks(current);
    expect(check).toMatchObject({ kind: "rollover", status: "uncertain", subject: "2024@cp0" });
    expect(renderComment(check!.comment)).toBe(
      "„2024“ steht, wo der Satz das Berichtsjahr 2025 beschreibt.",
    );
  });

  it("lässt Vergleiche, Vorjahresangaben und den früheren Prüfer unbeanstandet", () => {
    const current = buildDocument("c", "31. Dezember 2025", [
      { text: "Die Forderungen stiegen gegenüber dem 31. Dezember 2024 leicht an." },
      { text: "Der Buchwert beträgt EUR 20.203.251,67 (2024: 20.396.290,24)." },
      { text: "Die Prüfung zum 31. Dezember 2024 erfolgte durch einen anderen Abschlussprüfer." },
      { text: "Ab 2026 gilt der neue Standardansatz, eingeführt mit Verordnung (EU) 2024/1623." },
    ]);
    expect(priorChecks(current)).toEqual([]);
  });

  it("meldet eine alte Vergleichsangabe „(2023: …)“ im Bericht 2025", () => {
    const current = buildDocument("c", "31. Dezember 2025", [
      { text: "Der Buchwert beträgt EUR 20.203.251,67 (2023: 20.396.290,24)." },
    ]);
    const [check] = priorChecks(current);
    expect(check).toMatchObject({ status: "uncertain", subject: "2023@cp0" });
    expect(renderComment(check!.comment)).toContain("Berichtsjahr 2024");
  });

  it("meldet einen wortgleich übernommenen Absatz des Vorjahresberichts sicher", () => {
    const paragraph =
      "Im Geschäftsjahr 2024 bestanden Eventualverbindlichkeiten in Höhe von EUR 82.837.707,61.";
    const prior = buildDocument("p", "31. Dezember 2024", [{ text: paragraph }]);
    const current = buildDocument("c", "31. Dezember 2025", [{ text: paragraph }]);
    const [check] = priorChecks(current, prior);
    expect(check).toMatchObject({
      kind: "rollover",
      status: "mismatch",
      sourceKind: "prior_report",
      sourceBlockIds: ["pp0"],
      subject: "2024@cp0",
    });
    expect(renderComment(check!.comment)).toBe(
      "Absatz wie im Vorjahresbericht (Seite 3); „2024“ ist unverändert geblieben.",
    );
  });

  it("erkennt auch nur geänderte Beträge im alten Absatz als nicht fortgeschrieben", () => {
    const prior = buildDocument("p", "31. Dezember 2024", [
      { text: "Die Stabilitätsabgabe beträgt EUR 163.293,44 (2023: EUR 158.001,12)." },
    ]);
    const current = buildDocument("c", "31. Dezember 2025", [
      { text: "Die Stabilitätsabgabe beträgt EUR 596.373,43 (2023: EUR 163.293,44)." },
    ]);
    expect(priorChecks(current, prior)).toMatchObject([
      { status: "mismatch", comment: { code: "year_not_rolled" }, subject: "2023@cp0" },
    ]);
  });

  it("vergleicht nicht mit einem Vorjahresbericht eines anderen Jahres", () => {
    const paragraph = "Im Geschäftsjahr 2024 wurde die Kaution von EUR 80.000,00 geleistet.";
    const older = buildDocument("p", "31. Dezember 2023", [
      { text: "Bilanz zum 31. Dezember 2023" },
      { text: paragraph },
    ]);
    const current = buildDocument("c", "31. Dezember 2025", [{ text: paragraph }]);
    expect(priorChecks(current, older).map((check) => check.status)).toEqual(["uncertain"]);
  });
});

describe("Vorjahresspalte gegen den Vorjahresbericht", () => {
  it("bestätigt übereinstimmende Vorjahreswerte", () => {
    const checks = priorChecks(
      buildDocument("c", "31. Dezember 2025", [balance2025]),
      buildDocument("p", "31. Dezember 2024", [balance2024]),
    );
    expect(checks.map((check) => [check.subject, check.status])).toEqual([
      ["395.356.783,11", "match"],
      ["110.310,00", "match"],
    ]);
  });

  it("meldet einen abweichenden Vorjahreswert mit Soll-Wert aus dem Vorjahresbericht", () => {
    const changed = {
      ...balance2025,
      cells: balance2025.cells.map((row) =>
        row[0] === "Sonstige Vermögensgegenstände" ? [row[0], "774.491,78", "101.310,00"] : row,
      ),
    };
    const check = priorChecks(
      buildDocument("c", "31. Dezember 2025", [changed]),
      buildDocument("p", "31. Dezember 2024", [balance2024]),
    ).find((entry) => entry.subject === "101.310,00")!;
    expect(check).toMatchObject({ kind: "prior_report", status: "mismatch" });
    expect(renderComment(check.comment)).toBe(
      "Vorjahr weicht um 9.000,00 EUR vom Vorjahresbericht (Seite 3) ab: dort 110.310,00 EUR.",
    );
  });

  it("vergleicht TEUR im Vorjahresbericht mit EUR im Bericht innerhalb der Rundung", () => {
    const prior = buildDocument("p", "31. Dezember 2024", [
      {
        table: 1,
        cells: [
          [null, "31.12.2024 TEUR", "31.12.2023 TEUR"],
          ["Forderungen an Kunden", "395.357", "402.118"],
        ],
      },
    ]);
    const [check] = priorChecks(buildDocument("c", "31. Dezember 2025", [balance2025]), prior);
    expect(check).toMatchObject({ subject: "395.356.783,11", status: "match", rounded: true });
  });

  it("prüft nichts, wenn eine Zeile zwei Beträge derselben Periode trägt", () => {
    const prior = buildDocument("p", "31. Dezember 2024", [
      {
        table: 1,
        cells: [
          [null, "2024 TEUR", "2024 TEUR"],
          ["Forderungen an Kunden", "395", "357"],
        ],
      },
    ]);
    expect(priorChecks(buildDocument("c", "31. Dezember 2025", [balance2025]), prior)).toEqual([]);
  });
});
