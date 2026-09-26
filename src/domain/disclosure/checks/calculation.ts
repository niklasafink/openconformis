import type { CheckKind } from "./types";

/**
 * Der Rechenweg einer Prüfung als Schritte von oben nach unten, so wie das Popover ihn
 * als Mini-Tabelle zeigt: erste Zeile ohne Operator, jede weitere mit +, −, × oder ÷.
 * Rein aus dem, was der Lauf speichert; wo der Rechenweg nicht sicher ist, `null`.
 */

export type CalculationOperator = "+" | "−" | "×" | "÷";

export type CalculationStep =
  | Readonly<{ operator: CalculationOperator | null; figureId: string }>
  | Readonly<{ operator: CalculationOperator; constant: string }>;

/** Quelle der Prozentveränderung im Satz: (Berichtsjahr − Vorjahr) ÷ Vorjahr. */
export const percentChangeLabel = "Veränderung / Vorjahr";

const percentStep: CalculationStep = { operator: "×", constant: "100" };

export function calculationSteps(
  check: Readonly<{
    kind: CheckKind;
    sourceFigureIds: readonly string[];
    sourceSigns: readonly number[] | null;
    sourceLabel: string;
  }>,
): CalculationStep[] | null {
  const ids = check.sourceFigureIds;
  if (ids.length === 0) return null;
  if (check.sourceSigns && check.sourceSigns.length === ids.length) {
    return ids.map((figureId, index) => ({
      figureId,
      operator: check.sourceSigns![index]! < 0 ? "−" : index === 0 ? null : "+",
    }));
  }
  if (check.kind === "ratio" && ids.length === 2) {
    const [first, second] = ids as [string, string];
    if (check.sourceLabel === percentChangeLabel) {
      // Bezugszahlen in Satzreihenfolge: Vorjahr, dann Berichtsjahr.
      return [
        { operator: null, figureId: second },
        { operator: "−", figureId: first },
        { operator: "÷", figureId: first },
        percentStep,
      ];
    }
    if (/^[^/]+ \/ [^/]+$/u.test(check.sourceLabel)) {
      return [
        { operator: null, figureId: first },
        { operator: "÷", figureId: second },
        percentStep,
      ];
    }
  }
  if (check.kind === "derived" && ids.length === 2 && /^[^−]+ − [^−]+$/u.test(check.sourceLabel)) {
    return [
      { operator: null, figureId: ids[0]! },
      { operator: "−", figureId: ids[1]! },
    ];
  }
  return null;
}
