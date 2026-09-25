import { describe, expect, it } from "vitest";

import { editableValue, formatAcceptedValue, parseAcceptedValue } from "./correction";

const euro = { unit: "EUR" as const, scale: 1, decimals: 2 };
const teur = { unit: "EUR" as const, scale: 1_000, decimals: 1 };

describe("übernommene Zahlen", () => {
  it("liest den Wert in der Darstellung der geprüften Zahl", () => {
    expect(parseAcceptedValue("774.391,78", euro)).toBe(774_391_780_000n);
    expect(parseAcceptedValue("932,9", teur)).toBe(932_900_000_000n);
    expect(parseAcceptedValue("-0,6", { unit: "EUR", scale: 1_000_000, decimals: 1 })).toBe(
      -600_000_000_000n,
    );
    expect(parseAcceptedValue(" 115 ", { unit: "EUR", scale: 1_000, decimals: 0 })).toBe(
      115_000_000_000n,
    );
  });

  it("nimmt nur Zahlen an, nie Text oder Rechnungen", () => {
    for (const input of ["", "abc", "115 TEUR", "110-54", "1,2,3", "12.34", "=1+1"]) {
      expect(parseAcceptedValue(input, euro)).toBeNull();
    }
  });

  it("zeigt und belegt den Wert wie das Dokument", () => {
    expect(formatAcceptedValue(774_391_780_000n, euro)).toBe("774.391,78 EUR");
    expect(formatAcceptedValue(115_000_000_000n, { unit: "EUR", scale: 1_000, decimals: 0 })).toBe(
      "115 TEUR",
    );
    expect(editableValue(932_900_000_000n, teur)).toBe("932,9");
    expect(editableValue(774_391_780_000n, euro)).toBe("774.391,78");
  });
});
