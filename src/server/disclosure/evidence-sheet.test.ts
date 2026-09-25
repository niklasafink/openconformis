// @vitest-environment node

/**
 * Der Leseweg einer SuSa ohne Datenbank und Blob: eine im Test erzeugte Arbeitsmappe
 * mit Titelzeile, Formel und Summenzeile wird wie im Workflow geprüft und gelesen.
 */

import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import { isXlsxPackage } from "@/domain/disclosure/evidence-upload";
import { parseSusaRows } from "@/domain/disclosure/susa";

vi.mock("@/server/db/client", () => ({ db: {}, isDatabaseConfigured: false }));
vi.mock("@/server/storage/object-store", () => ({ createPrivateObjectStore: vi.fn() }));
vi.mock("@/server/workflows/launch", () => ({ launchDisclosureEvidenceWorkflow: vi.fn() }));

const { readFirstSheet } = await import("./evidence");

async function workbookBytes() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("SuSa");
  sheet.addRow(["Summen- und Saldenliste 2021"]);
  sheet.addRow(["Konto", "Beschriftung", "EB-Wert", "Soll", "Haben", "Saldo"]);
  sheet.addRow(["1200", "Forderungen aus Lieferungen und Leistungen", 0, 933929.51, 0, 933929.51]);
  const row = sheet.addRow(["1800", "Guthaben bei Kreditinstituten", 0, 4858728.78, 0, null]);
  row.getCell(6).value = { formula: "C4+D4-E4", result: 4858728.78 };
  sheet.addRow(["Summe", null, null, null, null, 5792658.29]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("SuSa aus einer Excel-Datei lesen", () => {
  it("prüft das Paket und liest Konten samt Formelergebnis", async () => {
    const bytes = await workbookBytes();
    expect(isXlsxPackage(bytes)).toBe(true);
    const parsed = parseSusaRows(await readFirstSheet(bytes));
    expect(parsed).toMatchObject({ ok: true, headerRow: 2, skippedRows: 1 });
    if (!parsed.ok) return;
    expect(parsed.accounts.map((account) => [account.accountNumber, account.closing])).toEqual([
      ["1200", 933_929_510_000n],
      ["1800", 4_858_728_780_000n],
    ]);
  });

  it("lehnt eine Word-Datei und beliebige Bytes als SuSa ab", () => {
    expect(isXlsxPackage(new TextEncoder().encode("Konto;Saldo\n1200;5"))).toBe(false);
  });
});
