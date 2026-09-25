import { describe, expect, it } from "vitest";

import { deriveDocumentContext, type ContextInputBlock } from "../document-context";
import { recognizeFigures } from "../figures";
import { recognizeStatements } from "../statements";

import { renderComment, renderFindingTitle } from "./comments";
import { deriveFindings, markStatuses } from "./findings";
import { runDeterministicChecks } from "./run";
import { sentencesOf } from "./text";
import type {
  CheckDraft,
  EngineBlock,
  EngineDocument,
  EngineFigure,
  EngineStatement,
} from "./types";

/**
 * Die Prüfungen an Auszügen der beiden Beispielberichte (gbs 2021, ICBC 2025). Jeder
 * Test baut ein kleines Dokument aus Absätzen und Tabellenzellen, erkennt Zahlen wie die
 * Aufbereitung und prüft Status, Soll-Wert und Kommentar.
 */

type Spec =
  | { text: string; type?: string }
  | { table: number; cells: Array<Array<string | null>>; header?: number };

const million = 1_000_000n;

function buildDocument(specs: Spec[], year = "31. Dezember 2021"): EngineDocument {
  const inputs: ContextInputBlock[] = [
    { id: "year", blockType: "paragraph", text: `Jahresabschluss zum ${year}` },
  ];
  for (const [specIndex, spec] of specs.entries()) {
    if ("text" in spec) {
      inputs.push({ id: `p${specIndex}`, blockType: spec.type ?? "paragraph", text: spec.text });
      continue;
    }
    spec.cells.forEach((row, rowIndex) =>
      row.forEach((text, column) => {
        if (text === null) return;
        inputs.push({
          id: `t${spec.table}r${rowIndex}c${column}`,
          blockType: "table_cell",
          text,
          cell: { table: spec.table, row: rowIndex, column, header: rowIndex < (spec.header ?? 0) },
        });
      }),
    );
  }
  const { reportYear, contexts } = deriveDocumentContext(inputs);
  const blocks: EngineBlock[] = [];
  const figures: EngineFigure[] = [];
  const statements: EngineStatement[] = [];
  inputs.forEach((input, ordinal) => {
    const context = contexts.get(input.id)!;
    const table = context.table;
    blocks.push({
      id: input.id,
      ordinal,
      type: input.blockType,
      text: input.text,
      page: context.pageNumber,
      tz: context.tz,
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
    recognizeStatements(input.text, input.blockType).forEach((statement, index) =>
      statements.push({ id: `${input.id}:s${index}`, blockId: input.id, ...statement }),
    );
  });
  return { blocks, figures, statements, reportYear };
}

function checksOf(document: EngineDocument) {
  const { drafts } = runDeterministicChecks(document);
  const figureRaw = new Map(document.figures.map((figure) => [figure.id, figure.raw]));
  const statementRaw = new Map(
    document.statements.map((statement) => [statement.id, statement.raw]),
  );
  return drafts.map((draft) => ({
    ...draft,
    subject: draft.subjectFigureId
      ? figureRaw.get(draft.subjectFigureId)!
      : statementRaw.get(draft.subjectStatementId!)!,
  }));
}

function find(checks: ReturnType<typeof checksOf>, subject: string, kind?: CheckDraft["kind"]) {
  return checks.filter((check) => check.subject === subject && (!kind || check.kind === kind));
}

/** Anlage 2.1 der gbs in kleinem Ausschnitt: Bilanzsumme, Eigenkapital, Rückstellungen. */
const gbsAssets: Spec = {
  table: 1,
  header: 2,
  cells: [
    [null, "31.12.2021", null, "31.12.2020", null],
    [null, "TEUR", "%", "TEUR", "%"],
    ["AKTIVA", null, null, null, null],
    ["Liquide Mittel", "4.858,7", "71,2", "8.410,9", "81,9"],
    ["Übrige Aktiva", "1.969,5", "28,8", "1.857,9", "18,1"],
    ["Bilanzsumme", "6.828,2", "100,0", "10.268,8", "100,0"],
    ["PASSIVA", null, null, null, null],
    ["Eigenkapital", "1.641,0", "24,0", "5.071,4", "49,4"],
    ["Rückstellungen", "4.749,9", "69,5", "4.790,8", "46,7"],
    ["Verbindlichkeiten", "437,3", "6,4", "406,6", "3,9"],
    ["Bilanzsumme", "6.828,2", "100,0", "10.268,8", "100,0"],
  ],
};

describe("sentence arithmetic and direction words", () => {
  it("gbs Tz 6: von TEUR 790 um TEUR 161 auf TEUR 951 gestiegen", () => {
    const checks = checksOf(
      buildDocument([
        {
          text: "Der Materialaufwand enthält im Wesentlichen Aufwendungen für externe Mitarbeiter und ist von TEUR 790 um TEUR 161 auf TEUR 951 gestiegen.",
        },
      ]),
    );
    expect(find(checks, "161", "sentence_arithmetic")[0]).toMatchObject({
      status: "match",
      rounded: false,
    });
    expect(find(checks, "gestiegen", "direction")[0]).toMatchObject({ status: "match" });
  });

  it("gbs Tz 62: „Erhöhung der Bilanzsumme“ widerspricht 10.268,8 → 6.828,2 TEUR (rot)", () => {
    const checks = checksOf(
      buildDocument([
        gbsAssets,
        {
          text: "62 Insgesamt ergab sich damit eine Veränderung des Eigenkapitals um TEUR -3.430 bzw. -67,6 % auf TEUR 1.641. Unter Berücksichtigung der Erhöhung der Bilanzsumme führte dies zu einer Verringerung der Eigenkapitalquote um 25,4 %-Punkte auf 24,0 %.",
        },
      ]),
    );
    const increase = find(checks, "Erhöhung", "direction")[0]!;
    expect(increase.status).toBe("mismatch");
    expect(renderComment(increase.comment)).toBe(
      "Text sagt „Erhöhung“, Zahlen gehen von 10.268,8 TEUR auf 6.828,2 TEUR.",
    );
    expect(find(checks, "Verringerung", "direction")[0]!.status).toBe("match");
    expect(find(checks, "-3.430", "sentence_arithmetic")[0]!.status).toBe("match");
    expect(find(checks, "-67,6", "ratio")[0]!.status).toBe("match");
    expect(find(checks, "24,0", "ratio")[0]!.status).toBe("match");
  });

  it("gbs Tz 5: Personalaufwand um TEUR 736 auf TEUR 6.364 stimmt mit Vorjahr 7.099,7 (grün, gerundet)", () => {
    const checks = checksOf(
      buildDocument([
        {
          table: 1,
          header: 1,
          cells: [
            [null, "2021 TEUR", "2020 TEUR"],
            ["Personalaufwand", "6.363,7", "7.099,7"],
          ],
        },
        { text: "Der Personalaufwand verringerte sich um TEUR 736 auf TEUR 6.364." },
      ]),
    );
    expect(find(checks, "736", "sentence_arithmetic")[0]).toMatchObject({
      status: "match",
      rounded: true,
    });
    expect(find(checks, "6.364", "cross_reference")[0]).toMatchObject({
      status: "match",
      rounded: true,
    });
    expect(find(checks, "verringerte sich", "direction")[0]!.status).toBe("match");
  });

  it("gbs Tz 80 ↔ Tz 9: Eigenkapital per 30. Juni 2022 „-0,6“ gegen „0,6“ Mio. EUR (rot)", () => {
    const checks = checksOf(
      buildDocument([
        {
          text: "Die Entwicklung im ersten Halbjahr 2022 mit knapp -1,0 Mio. EUR Fehlbetrag und einem per 30. Juni 2022 verbleibenden Eigenkapital von 0,6 Mio. EUR lässt nicht darauf schließen, dass eine Ertragswende erreicht werden kann.",
        },
        {
          text: "80 Gemäß den uns vorgelegten vorläufigen Zahlen per 30. Juni 2022 beläuft sich der aufgelaufene Fehlbetrag im Geschäftsjahr 2022 auf -1,0 Mio. EUR und das verbleibende Eigenkapital per 30. Juni 2022 auf -0,6 Mio. EUR.",
        },
      ]),
    );
    expect(find(checks, "0,6")[0]).toMatchObject({
      status: "mismatch",
      comment: { code: "reference_sign" },
    });
    expect(find(checks, "-0,6")[0]).toMatchObject({
      status: "mismatch",
      comment: { code: "reference_sign" },
    });
    expect(find(checks, "-1,0").map((check) => check.status)).toEqual(["match", "match"]);
  });

  it("gbs Lagebericht: Fremdkapital sinkt von 5.198 auf 5.187 TEUR — grün, gerundet, aus Bilanzsumme − Eigenkapital", () => {
    const checks = checksOf(
      buildDocument([gbsAssets, { text: "Das Fremdkapital sinkt von 5.198 TEUR auf 5.187 TEUR." }]),
    );
    const prior = find(checks, "5.198")[0]!;
    expect(prior).toMatchObject({ kind: "derived", status: "match", rounded: true });
    expect(prior.expected).toBe(5_197_400n * million);
    expect(renderComment(prior.comment)).toContain("Bilanzsumme − Eigenkapital");
    expect(find(checks, "5.187")[0]).toMatchObject({ status: "match" });
  });

  it("gbs Lagebericht: Jahresfehlbetrag, Steuern von - 380 TEUR und Rückstellungen mit 70 %", () => {
    const checks = checksOf(
      buildDocument([
        gbsAssets,
        {
          table: 2,
          header: 1,
          cells: [
            [null, "2021 TEUR", "2020 TEUR"],
            ["Zinsergebnis", "1,6", "-6,5"],
            ["Steuern vom Einkommen und vom Ertrag", "-381,0", "739,1"],
            ["Jahresergebnis", "-3.430,5", "1.507,7"],
          ],
        },
        {
          text: "Nach Berücksichtigung des Zinsergebnisses von 2 TEUR (Vorjahr -7 TEUR) und Steuern von - 380 TEUR (Vorjahr 739 TEUR) wurde ein Jahresfehlbetrag von 3.430 TEUR (Vorjahr Jahresüberschuss 1.507 TEUR) erzielt.",
        },
        {
          text: "Auf der Passivseite bilden das Eigenkapital mit 24 % und Rückstellungen mit 70 % die wesentlichen Positionen.",
        },
      ]),
    );
    expect(find(checks, "- 380")[0]).toMatchObject({ status: "match", rounded: true });
    expect(find(checks, "3.430")[0]).toMatchObject({
      status: "match",
      actual: -3_430_000n * million,
    });
    expect(find(checks, "1.507")[0]).toMatchObject({
      kind: "prior_year",
      status: "match",
      rounded: true,
    });
    expect(find(checks, "70")[0]).toMatchObject({ kind: "ratio", status: "match", rounded: true });
  });
});

describe("orange: uncertain assignment", () => {
  it("gbs Lagebericht: „um 72 TEUR (Vorjahr 181 TEUR)“ ist mehrdeutig", () => {
    const checks = checksOf(
      buildDocument([
        { text: "Das Anlagevermögen hat sich um 72 TEUR (Vorjahr 181 TEUR) verringert." },
      ]),
    );
    expect(find(checks, "72")[0]).toMatchObject({
      status: "uncertain",
      comment: { code: "prior_ambiguous" },
    });
  });

  it("ICBC Lagebericht: „Verwaltungsaufwand 2,1 Mio.“ passt zu keinem der zwei GuV-Posten", () => {
    const checks = checksOf(
      buildDocument(
        [
          {
            table: 1,
            header: 1,
            cells: [
              [null, "2025 in EUR", "2024 in EUR"],
              ["8. Allgemeine Verwaltungsaufwendungen", "-9.101.246,87", "-8.560.035,97"],
              [
                "b) sonstige Verwaltungsaufwendungen (Sachaufwand)",
                "-1.795.596,57",
                "-1.721.609,34",
              ],
            ],
          },
          {
            text: "Im Wesentlichen bestehen die Aufwendungen aus dem Personalaufwand in Höhe von EUR 7,3 Millionen (2024: EUR 6,8 Millionen) und dem Verwaltungsaufwand in Höhe von EUR 2,1 Millionen (2024: EUR 2,2 Millionen), der Miete und bezogene Leistungen umfasst.",
          },
        ],
        "31. Dezember 2025",
      ),
    );
    expect(find(checks, "2,1")[0]).toMatchObject({
      status: "uncertain",
      comment: { code: "reference_candidates" },
    });
  });

  it("gbs Anlage 2.2: nur das Betriebsergebnis der neutral/ordentlich gegliederten Tabelle bleibt orange", () => {
    const checks = checksOf(
      buildDocument([
        {
          table: 1,
          header: 1,
          cells: [
            [null, "2021 TEUR", "2020 TEUR"],
            ["Personalaufwand", "-6.364,0", "-7.099,7"],
            ["Betriebsergebnis", "-3.811,9", "2.254,2"],
          ],
        },
        {
          table: 2,
          header: 1,
          cells: [
            [null, "2021 TEUR", "2020 TEUR"],
            ["Ordentliche betriebliche Erträge", "3.475,8", "11.731,4"],
            ["Personalaufwand", "-6.312,7", "-7.050,1"],
            ["Betriebsergebnis", "-3.922,3", "2.618,4"],
            ["Neutrales Ergebnis", "109,3", "-365,2"],
          ],
        },
      ]),
    );
    expect(find(checks, "-3.922,3")[0]).toMatchObject({
      status: "uncertain",
      comment: { code: "reference_structure" },
    });
    // Aufwandsposten verschiebt die andere Gliederung zwangsläufig: kein Hinweis.
    expect(find(checks, "-6.312,7").filter((check) => check.status !== "match")).toEqual([]);
    expect(find(checks, "-7.050,1").filter((check) => check.status !== "match")).toEqual([]);
  });
});

describe("tables", () => {
  it("gbs Bilanz in Staffelform: Summen stimmen, Aktiva = Passiva", () => {
    const checks = checksOf(
      buildDocument([
        {
          table: 1,
          header: 2,
          cells: [
            [null, null, "31.12.2021", "31.12.2020"],
            [null, "EUR", "EUR", "EUR"],
            ["A. Anlagevermögen", null, null, null],
            ["Software", "10.566,00", null, "9.774,09"],
            ["Andere Anlagen", "98.070,00", null, "171.423,06"],
            ["Sonstige Ausleihungen", "50,00", null, "50,00"],
            ["Anlagevermögen insgesamt", null, "108.686,00", "181.247,15"],
            ["B. Umlaufvermögen", null, "6.719.544,37", "10.087.521,20"],
            ["Summe der Aktiva", null, "6.828.230,37", "10.268.768,35"],
          ],
        },
        {
          table: 2,
          header: 2,
          cells: [
            [null, null, "31.12.2021", "31.12.2020"],
            [null, "EUR", "EUR", "EUR"],
            ["A. Eigenkapital", null, "1.640.943,19", "5.071.388,55"],
            ["B. Rückstellungen", null, null, null],
            ["1. Rückstellungen für Pensionen", "3.094.179,00", null, "2.936.817,00"],
            ["2. Sonstige Rückstellungen", "1.655.656,08", null, "1.853.967,67"],
            ["C. Verbindlichkeiten", null, "4.749.835,08", "4.790.784,67"],
            ["1. Verbindlichkeiten aus Lieferungen", "422.390,35", null, "406.595,13"],
            [null, null, "422.390,35", "406.595,13"],
            ["D. Rechnungsabgrenzungsposten", null, "15.061,75", null],
            ["Summe der Passiva", null, "6.828.230,37", "10.268.768,35"],
          ],
        },
      ]),
    );
    expect(find(checks, "108.686,00", "table_sum")[0]).toMatchObject({ status: "match" });
    expect(find(checks, "181.247,15", "table_sum")[0]).toMatchObject({ status: "match" });
    // Die verschobene Summe in der Zeile „C. Verbindlichkeiten“ ist die der Rückstellungen.
    expect(find(checks, "4.749.835,08", "table_sum")[0]).toMatchObject({ status: "match" });
    expect(checks.filter((check) => check.kind === "balance").map((check) => check.status)).toEqual(
      ["match", "match"],
    );
    expect(checks.filter((check) => check.status === "mismatch")).toEqual([]);
  });

  it("gbs Bilanz mit Vorspalte „EUR“ ist keine regionale Gliederung: ihre Werte stehen für Querverweise bereit", () => {
    const checks = checksOf(
      buildDocument([
        {
          table: 1,
          header: 2,
          cells: [
            [null, null, "31.12.2021", "31.12.2020"],
            [null, "EUR", "EUR", "EUR"],
            ["C. Verbindlichkeiten", null, null, null],
            [
              "1. Verbindlichkeiten aus Lieferungen und Leistungen",
              "422.390,35",
              null,
              "406.595,13",
            ],
            ["2. Sonstige Verbindlichkeiten", "15.000,00", null, "1.000,00"],
            [null, null, "437.390,35", "407.595,13"],
          ],
        },
        {
          text: "Die Verbindlichkeiten aus Lieferungen und Leistungen betragen TEUR 422 (Vorjahr: TEUR 407).",
        },
      ]),
    );
    const reference = find(checks, "422").find((check) => check.kind === "cross_reference");
    expect(reference).toMatchObject({ status: "match", rounded: true });
    expect(reference?.sourceLabel).toContain("Verbindlichkeiten aus Lieferungen und Leistungen");
  });

  it("ICBC: Sonstige Vermögensgegenstände 774.491,78 in der Bilanz, 774.391,78 als Anhang-Summe (rot)", () => {
    const checks = checksOf(
      buildDocument(
        [
          {
            table: 1,
            header: 1,
            cells: [
              [null, "31.12.2025 in EUR", "31.12.2024 in EUR"],
              ["12. Sonstige Vermögensgegenstände", "774.491,78", "110.310,00"],
            ],
          },
          { text: "9. Sonstige Vermögensgegenstände", type: "heading" },
          {
            table: 2,
            header: 1,
            cells: [
              [null, "31.12.2025", "31.12.2024"],
              ["Fristigkeit (Restlaufzeit)", null, null],
              [null, "(in EUR)", "(in EUR)"],
              ["Bis 3 Monate", "2.190,00", "0"],
              ["3 Monate bis 1 Jahr", "418.827,50", "0"],
              ["Mehr als 1 Jahr bis 5 Jahre", "353.374,28", "110.310,00"],
              ["Mehr als 5 Jahre", "0", "0"],
              ["Summe", "774.391,78", "110.310,00"],
            ],
          },
        ],
        "31. Dezember 2025",
      ),
    );
    expect(find(checks, "774.391,78", "table_sum")[0]).toMatchObject({ status: "match" });
    const reference = find(checks, "774.491,78", "cross_reference")[0]!;
    expect(reference).toMatchObject({ status: "mismatch", expected: 77_439_178n * 10_000n });
    expect(renderComment(reference.comment)).toContain("100,00 EUR");
  });

  it("ICBC regionale Gliederung: Gesamt-Spalte gegen die Regionen", () => {
    const checks = checksOf(
      buildDocument(
        [
          {
            table: 1,
            header: 3,
            cells: [
              [
                null,
                "Inland",
                null,
                "Europa",
                null,
                "China",
                null,
                "Übrige Welt",
                null,
                "Gesamt",
                null,
              ],
              [
                null,
                "2025",
                "2024",
                "2025",
                "2024",
                "2025",
                "2024",
                "2025",
                "2024",
                "2025",
                "2024",
              ],
              [
                null,
                "in EUR",
                "in TEUR",
                "in EUR",
                "in TEUR",
                "in EUR",
                "in TEUR",
                "in EUR",
                "in TEUR",
                "in EUR",
                "in TEUR",
              ],
              [
                "1. Zinsen und ähnliche Erträge",
                "20.936.848,26",
                "30.518",
                "8.585.340,03",
                "11.040",
                "744.731,91",
                "3.183",
                "8.585.340,03",
                "5.225",
                "33.541.992,56",
                "49.966",
              ],
              [
                "5. Provisionsaufwendungen",
                "636.090,29",
                "15",
                "-321.170,70",
                "340",
                "0",
                "0",
                "0",
                "0",
                "314.919,99",
                "355",
              ],
            ],
          },
        ],
        "31. Dezember 2025",
      ),
    );
    expect(find(checks, "33.541.992,56", "horizontal_sum")[0]).toMatchObject({
      status: "mismatch",
      expected: 3_885_226_023n * 10_000n,
    });
    expect(find(checks, "49.966", "horizontal_sum")[0]!.status).toBe("match");
    // Nullen ohne Nachkommastellen vergröbern die Toleranz nicht: 0,40 EUR sind eine Abweichung.
    expect(find(checks, "314.919,99", "horizontal_sum")[0]!.status).toBe("mismatch");
  });

  it("Klammerwerte des Verbindlichkeitenspiegels bilden eine eigene Vorjahresreihe", () => {
    const checks = checksOf(
      buildDocument([
        {
          table: 1,
          cells: [
            ["__TEUR", null],
            ["Erhaltene Anzahlungen", "98"],
            ["auf Bestellungen", "(0)"],
            ["Lieferungen und Leistungen", "228"],
            ["Leistungen", "(113)"],
            ["gegenüber verbundenen Unternehmen", "16"],
            [null, "(34)"],
            ["sonstige", "80"],
            ["Verbindlichkeiten", "(259)"],
            [null, "422"],
            ["Summe", "(406)"],
          ],
        },
      ]),
    );
    expect(checks.filter((check) => check.status === "mismatch")).toEqual([]);
    expect(find(checks, "422", "table_sum")[0]!.status).toBe("match");
  });
});

describe("findings", () => {
  it("rot und orange werden Feststellungen, stille Unsicherheiten nicht", () => {
    const base = {
      subjectStatementId: null,
      comment: { code: "sum_matches" as const, params: {} },
    };
    const checks = [
      { ...base, kind: "table_sum" as const, status: "uncertain" as const, subjectFigureId: "a" },
      { ...base, kind: "cross_reference" as const, status: "match" as const, subjectFigureId: "b" },
      {
        ...base,
        kind: "cross_reference" as const,
        status: "mismatch" as const,
        subjectFigureId: "b",
      },
      { ...base, kind: "prior_year" as const, status: "uncertain" as const, subjectFigureId: "c" },
    ];
    const findings = deriveFindings(checks, (id) => ({ a: 3, b: 2, c: 1 })[id]!);
    expect(
      findings.map((finding) => [finding.subject, finding.check.status, finding.ordinal]),
    ).toEqual([
      ["c", "uncertain", 1],
      ["b", "mismatch", 2],
    ]);
    expect(markStatuses(checks).get("a")).toBeUndefined();
    expect(markStatuses(checks).get("b")).toBe("mismatch");
  });

  it("Kommentare bleiben unter 160, Titel unter 60 Zeichen", () => {
    const long = "x".repeat(200);
    expect(
      renderComment({
        code: "reference_differs",
        params: { source: long, expected: long, difference: long },
      }).length,
    ).toBeLessThanOrEqual(160);
    expect(
      renderFindingTitle({ code: "reference_differs", params: {} }, long).length,
    ).toBeLessThanOrEqual(60);
  });

  it("trennt Sätze nicht an Datumsangaben oder Beträgen am Satzende", () => {
    const text = "Zum 31. Dezember 2021 betrug es TEUR 1.506. Die Projektumsätze fielen.";
    expect(sentencesOf(text).map((span) => text.slice(span.start, span.end))).toEqual([
      "Zum 31. Dezember 2021 betrug es TEUR 1.506.",
      "Die Projektumsätze fielen.",
    ]);
  });
});

describe("model assignment", () => {
  const document = () =>
    buildDocument([
      {
        table: 1,
        header: 1,
        cells: [
          [null, "31.12.2021 TEUR", "31.12.2020 TEUR"],
          ["Forderungen gegen Beteiligungsunternehmen", "53,6", "110,3"],
          ["Bilanzsumme", "6.828,2", "10.268,8"],
        ],
      },
      {
        text: "Die Forderungen gegen Beteiligungsunternehmen von TEUR 54 (Vorjahr TEUR 110) betreffen die apoBank.",
      },
    ]);

  it("bietet die Zahl mit lexikalischen Kandidaten zur Einordnung an", () => {
    const { pending } = runDeterministicChecks(document());
    const entry = pending.find((item) => item.sentence.includes("TEUR 54"))!;
    expect(entry.candidates[0]).toEqual({
      key: "label:forderungen gegen beteiligungsunternehmen",
      label: "Forderungen gegen Beteiligungsunternehmen",
    });
  });

  it("rechnet die Zuordnung im Code nach: grün bei Treffer, orange unter der Schwelle", async () => {
    const { modelAssignmentChecks } = await import("./run");
    const built = document();
    const { resolver } = runDeterministicChecks(built);
    const figure = built.figures.find((item) => item.raw === "54")!;
    const assignment = {
      figureId: figure.id,
      key: "label:forderungen gegen beteiligungsunternehmen",
      label: "Forderungen gegen Beteiligungsunternehmen",
      period: "current" as const,
      candidateCount: 1,
    };
    const [match] = modelAssignmentChecks(
      built,
      resolver,
      [{ ...assignment, confidenceBp: 9_000 }],
      7_000,
    );
    expect(match).toMatchObject({
      status: "match",
      rounded: true,
      assignment: "model",
      confidenceBp: 9_000,
    });
    const [unsure] = modelAssignmentChecks(
      built,
      resolver,
      [{ ...assignment, period: "prior", confidenceBp: 5_000 }],
      7_000,
    );
    expect(unsure).toMatchObject({ status: "uncertain", comment: { code: "model_unsure" } });
  });
});

describe("Beleg-Abgleich mit der SuSa", () => {
  const balance: Spec = {
    table: 3,
    header: 1,
    cells: [
      [null, "31.12.2021 EUR", "31.12.2020 EUR"],
      ["Forderungen aus Lieferungen und Leistungen", "932.929,51", "1.012.340,10"],
      ["Guthaben bei Kreditinstituten", "4.858.728,78", "8.410.915,02"],
    ],
  };
  const cents = (value: string) => BigInt(value.replace(/[.,]/gu, "")) * 10_000n;
  const susa = [
    {
      id: "susa",
      accounts: [
        // Bewusst um 1.000,00 EUR daneben: die rote Markierung der Abnahme.
        {
          id: "a1200",
          accountNumber: "1200",
          label: "Forderungen aus Lieferungen und Leistungen",
          closing: cents("933.929,51"),
        },
        { id: "a1800", accountNumber: "1800", label: "Bank", closing: cents("4.000.000,00") },
        {
          id: "a1810",
          accountNumber: "1810",
          label: "Bank Festgeld",
          closing: cents("858.728,78"),
        },
        // Haben-Saldo einer Verbindlichkeit ohne Tabellenzeile: kein Abgleich.
        {
          id: "a3300",
          accountNumber: "3300",
          label: "Verbindlichkeiten aus Lieferungen und Leistungen",
          closing: -cents("228.104,76"),
        },
      ],
    },
  ];

  function evidenceOf(specs: Spec[]) {
    const document = buildDocument(specs);
    const raw = new Map(document.figures.map((figure) => [figure.id, figure.raw]));
    return runDeterministicChecks(document, susa)
      .drafts.filter((draft) => draft.kind === "evidence")
      .map((draft) => ({ ...draft, subject: raw.get(draft.subjectFigureId!)! }));
  }

  it("rot bei abweichendem Kontensaldo, mit Konto, Bezeichnung und Saldo als Quelle", () => {
    const checks = evidenceOf([balance]);
    const receivables = checks.find((check) => check.subject === "932.929,51")!;
    expect(receivables).toMatchObject({
      status: "mismatch",
      sourceKind: "evidence",
      sourceAccountIds: ["a1200"],
      expected: cents("933.929,51"),
    });
    expect(receivables.sourceLabel).toBe(
      "SuSa Konto 1200 · Forderungen aus Lieferungen und Leistungen · 933.929,51 EUR",
    );
    expect(renderComment(receivables.comment)).toBe(
      "Weicht um 1.000,00 EUR von SuSa Konto 1200 (933.929,51 EUR) ab.",
    );
    expect(renderFindingTitle(receivables.comment, receivables.subjectLabel ?? null)).toBe(
      "Abweichung zur SuSa: Forderungen aus Lieferungen und Leistu…",
    );
  });

  it("grün, wenn die Summe mehrerer Bankkonten den Bilanzwert exakt trifft", () => {
    const checks = evidenceOf([balance]);
    expect(checks.find((check) => check.subject === "4.858.728,78")).toMatchObject({
      status: "match",
      rounded: false,
      sourceAccountIds: ["a1800", "a1810"],
      sourceLabel: "SuSa Konten 1800, 1810 · Liquide Mittel · 4.858.728,78 EUR",
    });
  });

  it("grün mit Vermerk „gerundet“ gegen die TEUR-Tabelle", () => {
    const checks = evidenceOf([gbsAssets]);
    expect(checks.find((check) => check.subject === "4.858,7")).toMatchObject({
      status: "match",
      rounded: true,
    });
  });

  it("ohne Belegdatei gibt es keinen Abgleich", () => {
    const { drafts } = runDeterministicChecks(buildDocument([balance]));
    expect(drafts.some((draft) => draft.kind === "evidence")).toBe(false);
  });
});
