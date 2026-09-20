import type { ReviewColumnCriteria } from "@/domain/review/column";
import type { ReviewCellSummary } from "@/server/review/read-review";

/**
 * Reine Darstellungsregeln des Rasters: welche Beschriftung eine getypte Antwort
 * trägt und welche Antwort gilt. Kein Netz, kein Zustand — damit sie sich ohne
 * Browser prüfen lassen.
 */

export type TypedAnswer = {
  answerBoolean: boolean | null;
  answerChoice: string | null;
  answerScoreBp: number | null;
};

/** Die wirksame Antwort: ein menschlicher Override geht der KI-Antwort vor. */
export function effectiveAnswer(
  cell: Pick<ReviewCellSummary, "answerBoolean" | "answerChoice" | "answerScoreBp" | "override">,
): { answer: TypedAnswer; overridden: boolean } {
  if (cell.override) return { answer: cell.override, overridden: true };
  return {
    answer: {
      answerBoolean: cell.answerBoolean,
      answerChoice: cell.answerChoice,
      answerScoreBp: cell.answerScoreBp,
    },
    overridden: false,
  };
}

/** Die Stufe einer Score-Antwort aus ihrem Anteil an der Skala. */
export function scoreLevelOf(answerScoreBp: number, levelCount: number) {
  const last = levelCount - 1;
  if (last <= 0) return 0;
  return Math.min(last, Math.max(0, Math.round((answerScoreBp / 10_000) * last)));
}

/**
 * Beschriftung der Antwort in der Sprache des Nutzers — immer das `label` des
 * Kriteriums, nie die englische Beschreibung. Ohne passende Antwort `undefined`.
 */
export function answerLabel(
  criteria: ReviewColumnCriteria,
  answer: TypedAnswer,
): string | undefined {
  if (criteria.type === "noul" && typeof answer.answerBoolean === "boolean") {
    return answer.answerBoolean ? criteria.true.label : criteria.false.label;
  }
  if (criteria.type === "choice" && typeof answer.answerChoice === "string") {
    return criteria.options.find((option) => option.key === answer.answerChoice)?.label;
  }
  if (criteria.type === "score" && typeof answer.answerScoreBp === "number") {
    return criteria.levels[scoreLevelOf(answer.answerScoreBp, criteria.levels.length)]?.label;
  }
  return undefined;
}

/** Beschriftung eines Verteilungsschlüssels (`true`, `option_2`, `1`). */
export function distributionKeyLabel(criteria: ReviewColumnCriteria, key: string): string {
  if (criteria.type === "noul") {
    return key === "true" ? criteria.true.label : key === "false" ? criteria.false.label : key;
  }
  if (criteria.type === "choice") {
    return criteria.options.find((option) => option.key === key)?.label ?? key;
  }
  return criteria.levels[Number.parseInt(key, 10)]?.label ?? key;
}

/** Basispunkte als Prozentzahl in der Schreibweise des Nutzers, höchstens eine Nachkommastelle. */
export function percentOf(
  basisPoints: number | null | undefined,
  locale: string,
): string | undefined {
  if (basisPoints === null || basisPoints === undefined) return undefined;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(basisPoints / 100);
}

/** Zustände, in denen eine Zelle noch arbeitet. */
export const workingCellStates = new Set(["queued", "routing", "deciding", "escalated"]);

export const terminalRunStatuses = new Set([
  "completed",
  "completed_with_gaps",
  "failed",
  "cancelled",
]);

/**
 * Übernimmt eine Lieferung in die Zellkarte. Eine ältere `revision` wird
 * verworfen — das Delta darf doppelte und verspätete Zeilen enthalten.
 */
export function mergeCells(
  current: ReadonlyMap<string, ReviewCellSummary>,
  incoming: readonly ReviewCellSummary[],
): Map<string, ReviewCellSummary> | undefined {
  let next: Map<string, ReviewCellSummary> | undefined;
  for (const cell of incoming) {
    const known = current.get(cell.id);
    if (known && known.revision >= cell.revision) continue;
    next ??= new Map(current);
    next.set(cell.id, cell);
  }
  return next;
}

export function formatBytes(byteSize: number | null | undefined, locale: string) {
  if (!byteSize) return undefined;
  const megabytes = byteSize / 1024 / 1024;
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: megabytes < 1 ? 2 : 1 });
  return `${formatter.format(megabytes)} MB`;
}
