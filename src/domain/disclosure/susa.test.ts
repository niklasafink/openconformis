import { describe, expect, it } from "vitest";

import { parseSusaAmount, parseSusaRows, postenOfAccount } from "./susa";

const micro = (euros: string) => BigInt(euros.replace(/[.,]/gu, "")) * 10_000n;

describe("SuSa lesen", () => {
  it("erkennt die Kopfzeile eines DATEV-artigen Exports unter Titelzeilen", () => {
    const result = parseSusaRows([
      ["Summen- und Saldenliste 01/2021 - 12/2021", null, null],
      ["gbs GmbH", null, null],
      ["Konto", "Beschriftung", "EB-Wert", "Soll", "Haben", "Saldo"],
      [
        1200,
        "Forderungen aus Lieferungen und Leistungen",
        1012340.1,
        5400000,
        5478410.59,
        933929.51,
      ],
      ["Summe Klasse 1", null, null, null, null, 933929.51],
      ["1800", "Bank", "8.410.915,02", "12.000.000,00", "15.552.186,24", "4.858.728,78"],
    ]);
    expect(result).toMatchObject({ ok: true, headerRow: 3, skippedRows: 1 });
    if (!result.ok) return;
    expect(result.accounts).toEqual([
      expect.objectContaining({
        row: 4,
        accountNumber: "1200",
        closing: micro("933.929,51"),
        opening: micro("1.012.340,10"),
      }),
      expect.objectContaining({ row: 6, accountNumber: "1800", closing: micro("4.858.728,78") }),
    ]);
  });

  it("liest Haben-Salden über eine S/H-Spalte oder Saldo Soll/Haben negativ", () => {
    const indicator = parseSusaRows([
      ["Kontonummer", "Kontobezeichnung", "Saldo", "S/H"],
      ["3300", "Verbindlichkeiten aus Lieferungen und Leistungen", "228.104,76", "H"],
    ]);
    expect(indicator.ok && indicator.accounts[0]!.closing).toBe(-micro("228.104,76"));
    const split = parseSusaRows([
      ["Konto", "Bezeichnung", "Saldo Soll", "Saldo Haben"],
      ["3300", "Verbindlichkeiten aus Lieferungen und Leistungen", null, 228104.76],
    ]);
    expect(split.ok && split.accounts[0]!.closing).toBe(-micro("228.104,76"));
  });

  it("rechnet den Saldo aus EB, Soll und Haben, wenn keine Saldospalte da ist", () => {
    const result = parseSusaRows([
      ["Konto", "Bezeichnung", "EB-Wert", "Soll", "Haben"],
      ["1200", "Forderungen", "100,00", "50,50", "20,25"],
    ]);
    expect(result.ok && result.accounts[0]!.closing).toBe(micro("130,25"));
  });

  it("meldet fehlende Kopfzeile und fehlende Konten ausdrücklich", () => {
    expect(
      parseSusaRows([
        ["Name", "Wert"],
        ["x", 1],
      ]),
    ).toEqual({
      ok: false,
      code: "SUSA_HEADER_NOT_FOUND",
    });
    expect(
      parseSusaRows([
        ["Konto", "Bezeichnung", "Saldo"],
        ["Summe", null, 5],
      ]),
    ).toEqual({
      ok: false,
      code: "SUSA_NO_ACCOUNTS",
    });
  });

  it("liest Beträge exakt und verwirft unlesbare statt zu raten", () => {
    expect(parseSusaAmount("1.234,5")).toEqual({ micro: micro("1.234,50"), side: null });
    expect(parseSusaAmount("-12,00")).toEqual({ micro: -micro("12,00"), side: null });
    expect(parseSusaAmount("99,99 H")).toEqual({ micro: micro("99,99"), side: "H" });
    expect(parseSusaAmount(0.1 + 0.2)).toEqual({ micro: micro("0,30"), side: null });
    expect(parseSusaAmount("12.34")).toBeNull();
    expect(parseSusaAmount("n/a")).toBeNull();
  });
});

describe("Konten den Posten zuordnen", () => {
  it("über das Zeilenlabel der Bilanz und wenige Synonyme", () => {
    expect(postenOfAccount("Forderungen aus Lieferungen und Leistungen")?.key).toBe(
      "forderungen_ll",
    );
    expect(postenOfAccount("Guthaben bei Kreditinstituten")?.key).toBe("liquide_mittel");
    expect(postenOfAccount("Bank Festgeld")?.key).toBe("liquide_mittel");
    expect(postenOfAccount("Umsatzerlöse 19 % USt")?.key).toBe("umsatzerloese");
  });

  it("nie einem Sammelposten, von dem ein Konto nur ein Teil ist", () => {
    expect(postenOfAccount("Sonstige Rückstellungen")).toBeNull();
    expect(postenOfAccount("Verbindlichkeiten gegenüber Gesellschaftern")).toBeNull();
    expect(postenOfAccount("EDV-Software")).toBeNull();
  });
});
