import type { CheckComment, CheckKind, CheckStatus } from "./types";

/**
 * Vom Prüfergebnis zur Anzeige: welche Farbe eine Marke bekommt und welche Prüfungen zu
 * einer Feststellung werden. Rein, damit Lauf, Leseseite und Tests dieselbe Regel nutzen.
 */

export type CheckLike = Readonly<{
  kind: CheckKind;
  status: CheckStatus;
  subjectFigureId: string | null;
  subjectStatementId: string | null;
  comment: CheckComment;
}>;

/**
 * „Unsicher“ ohne Feststellung: eine Summe, deren Posten sich nicht sicher bestimmen
 * lassen, eine unvollständig lesbare Zeile und ein Richtungswort innerhalb der Rundung.
 * Sie färben die Marke nicht und erscheinen nur im Popover.
 */
export function isSilent(check: CheckLike) {
  return (
    check.status === "uncertain" &&
    (check.kind === "table_sum" ||
      check.kind === "horizontal_sum" ||
      check.comment.code === "direction_unclear")
  );
}

const rank: Record<CheckStatus, number> = { match: 0, uncertain: 1, mismatch: 2 };

/** Schlechtester zählender Status je Gegenstand (Zahl oder Richtungswort). */
export function markStatuses(checks: readonly CheckLike[]) {
  const statuses = new Map<string, CheckStatus>();
  for (const check of checks) {
    if (isSilent(check)) continue;
    const subject = check.subjectFigureId ?? check.subjectStatementId;
    if (!subject) continue;
    const current = statuses.get(subject);
    if (!current || rank[check.status] > rank[current]) statuses.set(subject, check.status);
  }
  return statuses;
}

/**
 * Eine Feststellung je Gegenstand mit rotem oder orangem Status; sie verweist auf die
 * schlechteste Prüfung. `order` ist die Lage im Dokument (Navigation).
 */
export function deriveFindings<T extends CheckLike>(
  checks: readonly T[],
  order: (subjectId: string) => number,
) {
  const worst = new Map<string, T>();
  for (const check of checks) {
    if (check.status === "match" || isSilent(check)) continue;
    const subject = check.subjectFigureId ?? check.subjectStatementId;
    if (!subject) continue;
    const current = worst.get(subject);
    if (!current || rank[check.status] > rank[current.status]) worst.set(subject, check);
  }
  return [...worst.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([subject, check], index) => ({ subject, check, ordinal: index + 1 }));
}
