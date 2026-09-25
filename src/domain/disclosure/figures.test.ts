import { describe, expect, it } from "vitest";

import { compareWithTolerance, formatMicro, ratioPercentMicro, sum } from "./arithmetic";
import { parseNumber, recognizeFigures, type RecognizedFigure } from "./figures";
import { recognizeStatements } from "./statements";

const paragraph = { blockType: "paragraph", reportYear: 2021 } as const;
const million = 1_000_000n;

function values(figures: RecognizedFigure[]) {
  return figures.map((figure) => ({ raw: figure.raw, micro: figure.micro, unit: figure.unit }));
}

describe("parseNumber", () => {
  it.each([
    ["1.234.567,89", 123456789n, 2],
    ["4.416,4", 44164n, 1],
    ["774.491,78", 77449178n, 2],
    ["194,508.62", 19450862n, 2],
    ["1.795.596.57", 179559657n, 2],
    ["7 .971", 7971n, 0],
    ["0,6", 6n, 1],
    ["34,04", 3404n, 2],
  ])("reads %s", (raw, digits, decimals) => {
    expect(parseNumber(raw)).toEqual({ digits, decimals });
  });

  it("refuses the unreadable form of the ICBC notes", () => {
    expect(parseNumber("1.344.989,.19")).toBeNull();
  });
});

describe("recognizeFigures on report sentences", () => {
  it("reads TEUR amounts before and after the number", () => {
    const text = "Die Erlöse mit den Gesellschaftern sanken um TEUR 5.478 auf TEUR 1.506.";
    expect(values(recognizeFigures(text, paragraph))).toEqual([
      { raw: "5.478", micro: 5_478_000n * million, unit: "EUR" },
      { raw: "1.506", micro: 1_506_000n * million, unit: "EUR" },
    ]);
    expect(
      values(recognizeFigures("Das Fremdkapital sinkt von 5.198 TEUR auf 5.187 TEUR.", paragraph)),
    ).toEqual([
      { raw: "5.198", micro: 5_198_000n * million, unit: "EUR" },
      { raw: "5.187", micro: 5_187_000n * million, unit: "EUR" },
    ]);
  });

  it("skips Tz numbers, statutes, dates and years", () => {
    const text =
      "62 Insgesamt ergab sich damit eine Veränderung des Eigenkapitals um TEUR -3.430 bzw. -67,6 % auf TEUR 1.641 gemäß § 321 Abs. 4a HGB zum 31. Dezember 2021.";
    expect(recognizeFigures(text, paragraph).map((figure) => figure.raw)).toEqual([
      "-3.430",
      "-67,6",
      "1.641",
    ]);
    expect(
      recognizeFigures("Mit Vertrag vom 8.12.2021 (UR-Nr. 508/2021) um 0.00 Uhr.", paragraph),
    ).toEqual([]);
  });

  it("marks prior-year values in parentheses", () => {
    const [current, prior] = recognizeFigures(
      "liquide Mittel in Höhe von TEUR 4.859 (Vorjahr: TEUR 8.411) gegenüber.",
      paragraph,
    );
    expect(current?.periodHint).toBeNull();
    expect(prior?.periodHint).toBe("prior");
    const [, bracketYear] = recognizeFigures(
      "in Höhe von EUR 198.411.130,80 (2024: 192.707.232,71) ist",
      { blockType: "paragraph", reportYear: 2025 },
    );
    expect(bracketYear?.periodHint).toBe("prior");
  });

  it("inherits the unit of a neighbouring figure", () => {
    const [current, prior] = recognizeFigures(
      "Der Anteil des Fremdkapitals von 5.187 (Vorjahr: 5.197 TEUR) an der Bilanzsumme",
      paragraph,
    );
    expect(current?.micro).toBe(5_187_000n * million);
    expect(current?.unit).toBe("EUR");
    expect(prior?.micro).toBe(5_197_000n * million);
  });

  it("reads Mio. and Millionen with the right scale and sign", () => {
    const [loss] = recognizeFigures(
      "verbleibende Eigenkapital per 30. Juni 2022 auf -0,6 Mio. EUR.",
      paragraph,
    );
    expect(loss?.micro).toBe(-600_000n * million);
    const [loans, prior] = recognizeFigures(
      "Kreditgeschäft an Kunden erhöhte sich geringfügig auf EUR 402,7 Millionen (2024: 395,4 Millionen)",
      { blockType: "paragraph", reportYear: 2025 },
    );
    expect(loans?.micro).toBe(402_700_000n * million);
    expect(loans?.displayUnit).toBe(100_000n * million);
    expect(prior?.micro).toBe(395_400_000n * million);
  });

  it("reads the misprinted amount of the ICBC notes and keeps unreadable ones grey", () => {
    const [from, to] = recognizeFigures(
      "Aufgliederung der sonstigen Verwaltungsaufwendungen, die von EUR 1.721.609,34 auf EUR 1.795.596.57gestiegen sind.",
      { blockType: "paragraph", reportYear: 2025 },
    );
    expect(from?.micro).toBe(172160934n * 10_000n);
    expect(to?.micro).toBe(179559657n * 10_000n);
    expect(to?.issue).toBeNull();
    const [unreadable] = recognizeFigures("1.344.989,.19", {
      blockType: "table_cell",
      columnUnit: { unit: "EUR", scale: 1 },
    });
    expect(unreadable?.issue).toBe("unreadable_format");
    expect(unreadable?.micro).toBeNull();
  });

  it("takes unit and period of a table cell from its column", () => {
    const [cell] = recognizeFigures("4.416,4", {
      blockType: "table_cell",
      columnUnit: { unit: "EUR", scale: 1_000 },
      columnPeriod: "current",
    });
    expect(cell).toMatchObject({
      micro: 4_416_400n * million,
      displayUnit: 100n * million,
      periodHint: "current",
    });
  });

  it("reads percentages", () => {
    const [share] = recognizeFigures(
      "Rückstellungen mit 70 % die wesentlichen Positionen",
      paragraph,
    );
    expect(share).toMatchObject({ unit: "percent", micro: 70n * million });
    const [ratio] = recognizeFigures("(a) Harte Kernkapitalquote 34,04%", paragraph);
    expect(ratio?.micro).toBe(34_040_000n);
  });
});

describe("recognizeStatements", () => {
  it("finds direction words as their own marks", () => {
    const text =
      "Unter Berücksichtigung der Erhöhung der Bilanzsumme führte dies zu einer Verringerung der Eigenkapitalquote.";
    expect(
      recognizeStatements(text, "paragraph").map((entry) => [entry.raw, entry.direction]),
    ).toEqual([
      ["Erhöhung", "up"],
      ["Verringerung", "down"],
    ]);
    expect(
      recognizeStatements("Der Personalaufwand verringerte sich um TEUR 736.", "paragraph")[0],
    ).toMatchObject({ raw: "verringerte sich", direction: "down" });
  });

  it("ignores table labels such as the GuV change in inventories", () => {
    expect(
      recognizeStatements(
        "Erhöhung (i.Vj. Verminderung) des Bestands an unfertigen Leistungen",
        "paragraph",
      ),
    ).toEqual([]);
    expect(recognizeStatements("Anstieg", "table_cell")).toEqual([]);
  });
});

describe("arithmetic acceptance cases", () => {
  const teur1 = (digits: bigint) => ({
    micro: digits * 100n * million,
    displayUnit: 100n * million,
  });
  const eur = (cents: bigint) => ({ micro: cents * 10_000n, displayUnit: 10_000n });
  const teur = (value: bigint) => ({
    micro: value * 1_000n * million,
    displayUnit: 1_000n * million,
  });

  it("gbs Fremdkapital 5.198 TEUR vs Bilanz-Vorjahr 5.197.379,80 is rounded", () => {
    const balance = eur(sum([479078467n, 40659513n]));
    expect(compareWithTolerance(teur(5_198n), balance)).toMatchObject({
      status: "match",
      rounded: true,
    });
  });

  it("gbs Personalaufwand: 7.099,7 − 736,0 = 6.363,7", () => {
    expect(compareWithTolerance(teur1(70997n - 7360n), teur1(63637n))).toMatchObject({
      status: "match",
      rounded: false,
    });
  });

  it("gbs balance sheet totals match exactly", () => {
    expect(sum([1056600n, 9807000n, 5000n])).toBe(10868600n);
    expect(sum([10868600n, 667767873n, 4186564n])).toBe(682823037n);
  });

  it("ICBC other assets: 774.491,78 vs 774.391,78 is a mismatch at cent precision", () => {
    const notes = eur(sum([219000n, 41882750n, 35337428n]));
    expect(notes.micro).toBe(77439178n * 10_000n);
    expect(compareWithTolerance(eur(77449178n), notes)).toMatchObject({ status: "mismatch" });
  });

  it("ICBC fee expenses differ by 3,40 EUR at cent precision", () => {
    expect(compareWithTolerance(eur(31491999n), eur(31491659n)).status).toBe("mismatch");
  });

  it("a sum of n rounded terms tolerates n display units", () => {
    expect(compareWithTolerance(teur1(1003n), teur1(1000n), 3).status).toBe("match");
    expect(compareWithTolerance(teur1(1004n), teur1(1000n), 3).status).toBe("mismatch");
  });

  it("gbs provisions share: 4.749,8 / 6.828,2 = 69,6 % reads as 70 %", () => {
    const ratio = ratioPercentMicro(47498n, 68282n)!;
    const stated = { micro: 70n * million, displayUnit: million };
    expect(compareWithTolerance(stated, { micro: ratio, displayUnit: 1n })).toMatchObject({
      status: "match",
      rounded: true,
    });
  });

  it("formats micro amounts for short comments", () => {
    expect(formatMicro(-3_430_400n * million, 1)).toBe("-3.430.400,0");
    expect(formatMicro(340n * 10_000n, 2, " EUR")).toBe("3,40 EUR");
  });
});

describe("recognizeFigures exclusions", () => {
  it("skips upper-case dates and postal codes", () => {
    expect(recognizeFigures("BILANZ ZUM 31. DEZEMBER 2021", paragraph)).toEqual([]);
    expect(
      recognizeFigures("gbs - Gesellschaft für Banksysteme GmbH 40880 Ratingen", paragraph),
    ).toEqual([]);
    expect(recognizeFigures("1220 Wien, Wagramer Straße 19", paragraph).map((f) => f.raw)).toEqual([
      "19",
    ]);
  });
});
