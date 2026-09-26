import { describe, expect, it } from "vitest";

import { calculationSteps, percentChangeLabel } from "./calculation";

describe("calculationSteps", () => {
  it("turns signs into + and −, the first term without operator", () => {
    expect(
      calculationSteps({
        kind: "table_sum",
        sourceFigureIds: ["a", "b", "c"],
        sourceSigns: [1, -1, 1],
        sourceLabel: "Seite 1 · Summe",
      }),
    ).toEqual([
      { operator: null, figureId: "a" },
      { operator: "−", figureId: "b" },
      { operator: "+", figureId: "c" },
    ]);
    expect(
      calculationSteps({
        kind: "sentence_arithmetic",
        sourceFigureIds: ["prior", "current"],
        sourceSigns: [-1, 1],
        sourceLabel: "Satz",
      }),
    ).toEqual([
      { operator: "−", figureId: "prior" },
      { operator: "+", figureId: "current" },
    ]);
  });

  it("divides a share by its total and scales to percent", () => {
    expect(
      calculationSteps({
        kind: "ratio",
        sourceFigureIds: ["equity", "total"],
        sourceSigns: null,
        sourceLabel: "Eigenkapital / Bilanzsumme",
      }),
    ).toEqual([
      { operator: null, figureId: "equity" },
      { operator: "÷", figureId: "total" },
      { operator: "×", constant: "100" },
    ]);
  });

  it("spells out a percentage change as difference over the prior year", () => {
    expect(
      calculationSteps({
        kind: "ratio",
        sourceFigureIds: ["prior", "current"],
        sourceSigns: null,
        sourceLabel: percentChangeLabel,
      }),
    ).toEqual([
      { operator: null, figureId: "current" },
      { operator: "−", figureId: "prior" },
      { operator: "÷", figureId: "prior" },
      { operator: "×", constant: "100" },
    ]);
  });

  it("subtracts for a two-term formula and stays silent otherwise", () => {
    expect(
      calculationSteps({
        kind: "derived",
        sourceFigureIds: ["total", "equity"],
        sourceSigns: null,
        sourceLabel: "Bilanzsumme − Eigenkapital",
      }),
    ).toEqual([
      { operator: null, figureId: "total" },
      { operator: "−", figureId: "equity" },
    ]);
    // Drei Operanden einer Quote: der Rechenweg ist nicht mehr eindeutig.
    expect(
      calculationSteps({
        kind: "ratio",
        sourceFigureIds: ["total", "equity", "total2"],
        sourceSigns: null,
        sourceLabel: "Fremdkapital / Bilanzsumme",
      }),
    ).toBeNull();
    expect(
      calculationSteps({
        kind: "cross_reference",
        sourceFigureIds: ["x"],
        sourceSigns: null,
        sourceLabel: "Seite 3",
      }),
    ).toBeNull();
    expect(
      calculationSteps({
        kind: "direction",
        sourceFigureIds: [],
        sourceSigns: null,
        sourceLabel: "",
      }),
    ).toBeNull();
  });
});
