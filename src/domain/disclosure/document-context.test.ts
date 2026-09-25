import { describe, expect, it } from "vitest";

import { deriveDocumentContext, type ContextInputBlock } from "./document-context";

let sequence = 0;
function block(text: string, blockType = "paragraph"): ContextInputBlock {
  sequence += 1;
  return { id: `b${sequence}`, blockType, text };
}
function cell(text: string, row: number, column: number, header = false): ContextInputBlock {
  sequence += 1;
  return {
    id: `c${sequence}`,
    blockType: "table_cell",
    text,
    cell: { table: 0, row, column, header },
  };
}

describe("deriveDocumentContext", () => {
  it("reads page markers, Tz numbers and the report year", () => {
    const blocks = [
      block("PDF-Seite 7"),
      block("Prüfungsbericht über die Prüfung des Jahresabschlusses zum 31. Dezember 2021"),
      block("8 Bei der Durchführung unserer Prüfung haben wir festgestellt"),
      block("PDF-Seite 8"),
      block("Die Entwicklung im ersten Halbjahr 2022 mit knapp -1,0 Mio. EUR Fehlbetrag"),
      block("Anlage 1.1"),
      block("Bilanz"),
    ];
    const { reportYear, contexts } = deriveDocumentContext(blocks);
    expect(reportYear).toBe(2021);
    expect(contexts.get(blocks[0]!.id)).toMatchObject({ technical: true, pageNumber: 7 });
    expect(contexts.get(blocks[4]!.id)).toMatchObject({ pageNumber: 8, tz: "8" });
    expect(contexts.get(blocks[6]!.id)?.tz).toBeNull();
  });

  it("derives period and unit of balance sheet columns like the gbs report", () => {
    const blocks = [
      block("BILANZ ZUM 31. DEZEMBER 2021"),
      cell("31.12.2021", 0, 2, true),
      cell("31.12.2020", 0, 3, true),
      cell("EUR", 1, 1, true),
      cell("EUR", 1, 2, true),
      cell("EUR", 1, 3, true),
      cell("II. Sachanlagen", 2, 0),
      cell("Andere Anlagen, Betriebs- und Geschäftsausstattung", 3, 0),
      cell("98.070,00", 3, 1),
      cell("171.423,06", 3, 3),
      cell("Anlagevermögen insgesamt", 4, 0),
      cell("108.686,00", 4, 2),
    ];
    const { contexts } = deriveDocumentContext(blocks);
    const detail = contexts.get(blocks[8]!.id)!.table!;
    expect(detail).toMatchObject({
      row: 3,
      column: 1,
      header: false,
      rowLabel: "Andere Anlagen, Betriebs- und Geschäftsausstattung",
    });
    expect(detail.columnInfo).toMatchObject({ unit: "EUR", scale: 1, period: "current" });
    expect(contexts.get(blocks[9]!.id)!.table!.columnInfo).toMatchObject({ period: "prior" });
    expect(contexts.get(blocks[10]!.id)!.table!.rowLabel).toBe("Anlagevermögen insgesamt");
    expect(contexts.get(blocks[1]!.id)!.table!.header).toBe(true);
  });

  it("spreads grouped headers over their columns like the ICBC regional table", () => {
    const blocks = [
      cell("Inland", 0, 1, true),
      cell("Gesamt", 0, 3, true),
      cell("2025", 1, 1, true),
      cell("2024", 1, 2, true),
      cell("2025", 1, 3, true),
      cell("2024", 1, 4, true),
      cell("in EUR", 2, 1, true),
      cell("in TEUR", 2, 2, true),
      cell("in EUR", 2, 3, true),
      cell("in TEUR", 2, 4, true),
      cell("5. Provisionsaufwendungen", 3, 0),
      cell("636.090,29", 3, 1),
      cell("15", 3, 2),
      cell("314.919,99", 3, 3),
      cell("355", 3, 4),
    ];
    const withYear = [block("Jahresabschluss zum 31. Dezember 2025"), ...blocks];
    const { contexts } = deriveDocumentContext(withYear);
    const total = contexts.get(blocks[13]!.id)!.table!;
    expect(total.columnInfo).toMatchObject({ unit: "EUR", scale: 1, period: "current" });
    expect(total.columnInfo?.label).toContain("Gesamt");
    expect(contexts.get(blocks[14]!.id)!.table!.columnInfo).toMatchObject({
      unit: "EUR",
      scale: 1_000,
      period: "prior",
    });
    expect(total.rowLabel).toBe("Provisionsaufwendungen");
  });

  it("lets a split balance sheet table inherit the columns of the table before it", () => {
    const first = [
      cell("31.12.2025 in EUR", 0, 1, true),
      cell("31.12.2024 in EUR", 0, 2, true),
      cell("4. Forderungen an Kunden", 1, 0),
      cell("402.688.268,51", 1, 1),
      cell("395.356.783,11", 1, 2),
    ];
    const second = [
      {
        ...cell("12. Sonstige Vermögensgegenstände", 0, 0),
        cell: { table: 1, row: 0, column: 0, header: false },
      },
      { ...cell("774.491,78", 0, 1), cell: { table: 1, row: 0, column: 1, header: false } },
      { ...cell("110.310,00", 0, 2), cell: { table: 1, row: 0, column: 2, header: false } },
    ];
    const { contexts } = deriveDocumentContext([
      block("Jahresabschluss zum 31. Dezember 2025"),
      ...first,
      block("darunter:"),
      ...second,
    ]);
    expect(contexts.get(second[1]!.id)!.table!.columnInfo).toMatchObject({
      unit: "EUR",
      period: "current",
    });
    expect(contexts.get(second[2]!.id)!.table!.columnInfo).toMatchObject({ period: "prior" });
  });
});
