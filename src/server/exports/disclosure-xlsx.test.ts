import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildDisclosureXlsx, createDisclosureExportFilename } from "./disclosure-xlsx";

describe("Export des Plausichecks", () => {
  it("führt Ist, Soll, übernommenen Wert, Freigabe und Verlauf auf", async () => {
    const bytes = await buildDisclosureXlsx({
      runId: "12345678-0000-4000-8000-000000000000",
      caseTitle: "ICBC 2025",
      locale: "de",
      completedAt: new Date("2026-09-26T10:00:00Z"),
      findings: [
        {
          ordinal: 1,
          title: "Abweichung zu anderer Angabe: Sonstige Vermögensgegenstände",
          severity: "mismatch",
          page: 15,
          tz: null,
          checkKind: "cross_reference",
          actual: "774.491,78 EUR",
          expected: "774.391,78 EUR",
          source: "Seite 25 · Sonstige Vermögensgegenstände, Summe",
          comment: '=HYPERLINK("x")',
          reviewStatus: "reviewed",
          acceptedValue: "774.391,78 EUR",
          acceptedReason: null,
          preparedBy: "Anna Prüferin",
          preparedAt: new Date("2026-09-26T10:05:00Z"),
          reviewedBy: "Maria Manager",
          reviewedAt: new Date("2026-09-26T10:10:00Z"),
          history: [
            {
              kind: "accepted",
              actor: "Anna Prüferin",
              at: new Date("2026-09-26T10:05:00Z"),
              body: "774.391,78 EUR",
            },
            {
              kind: "rejected",
              actor: "Maria Manager",
              at: new Date("2026-09-26T10:07:00Z"),
              body: null,
            },
            {
              kind: "released",
              actor: "Maria Manager",
              at: new Date("2026-09-26T10:10:00Z"),
              body: null,
            },
          ],
        },
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
    const sheet = workbook.getWorksheet("Feststellungen")!;
    const row = sheet.getRow(2).values as unknown[];
    expect(row.slice(1, 14)).toEqual([
      1,
      "Abweichung zu anderer Angabe: Sonstige Vermögensgegenstände",
      "Abweichung (rot)",
      15,
      "",
      "cross_reference",
      "774.491,78 EUR",
      "774.391,78 EUR",
      "Seite 25 · Sonstige Vermögensgegenstände, Summe",
      // Formeln aus Bericht oder Kommentar werden nie ausgeführt.
      '\'=HYPERLINK("x")',
      "geprüft",
      "774.391,78 EUR",
      "",
    ]);
    const history = workbook.getWorksheet("Verlauf")!;
    expect(history.rowCount).toBe(4);
    expect(history.getRow(3).getCell(3).value).toBe("abgelehnt");
    expect(createDisclosureExportFilename({ caseTitle: "ICBC 2025", runId: "12345678-x" })).toBe(
      "plausicheck-icbc-2025-12345678.xlsx",
    );
  });
});
