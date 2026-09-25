/**
 * Wann eine Zelle an das grosse Modell geht.
 *
 * Bei tausend Zellen ist Jev nicht der Kostentreiber — ein voller Lauf kostet dort
 * unter einem Euro. Der Hebel ist die Eskalationsquote: dasselbe Raster kostet bei
 * 12 % Eskalation ein Vielfaches davon. Deshalb steht die Regel hier als reine
 * Funktion, wird je Lauf eingefroren und hart gedeckelt.
 */

export type EscalationReason = "low_confidence" | "citation_needs_review";

export type EscalationDecision = {
  escalate: boolean;
  reason?: EscalationReason;
  /**
   * Die Zelle hätte eskaliert, aber das Budget ist erschöpft. Sie behält dann ihre
   * Jev-Antwort **mit gesetztem Prüfbedarf** — sichtbar offen, nicht still erledigt.
   */
  blockedByBudget: boolean;
};

export function decideEscalation(input: {
  confidenceBp: number;
  escalationThresholdBp: number;
  citationNeedsReview: boolean;
  /** Bereits eskalierte Zellen dieses Laufs. */
  escalatedSoFar: number;
  escalationBudgetCells: number;
}): EscalationDecision {
  const wanted: EscalationReason | undefined = input.citationNeedsReview
    ? "citation_needs_review"
    : input.confidenceBp < input.escalationThresholdBp
      ? "low_confidence"
      : undefined;

  if (!wanted) return { escalate: false, blockedByBudget: false };
  if (input.escalatedSoFar >= input.escalationBudgetCells) {
    return { escalate: false, reason: wanted, blockedByBudget: true };
  }
  return { escalate: true, reason: wanted, blockedByBudget: false };
}

/**
 * Der Zustand, in dem eine Zelle nach der Entscheidung landet. Eine Zelle, die
 * eskalieren wollte und nicht durfte, ist `needs_review` — nie `complete`.
 */
export function cellStateAfterDecision(input: {
  escalation: EscalationDecision;
  citationNeedsReview: boolean;
}): "complete" | "needs_review" | "escalated" {
  if (input.escalation.escalate) return "escalated";
  if (input.escalation.blockedByBudget || input.citationNeedsReview) return "needs_review";
  return "complete";
}

/**
 * Warum eine Zelle `needs_review` ist, abgeleitet aus dem Gespeicherten. Jeder Weg
 * dorthin hat einen nicht bestätigten Beleg oder eine Konfidenz unter der eingefrorenen
 * Schwelle — dieselbe Reihenfolge wie `decideEscalation`.
 */
export function reviewReasonOf(input: {
  state: string;
  citationVerdict: string | null;
  confidenceBp: number | null;
  escalationThresholdBp: number;
}): EscalationReason | null {
  if (input.state !== "needs_review") return null;
  if (input.citationVerdict !== "verified") return "citation_needs_review";
  if (input.confidenceBp === null || input.confidenceBp < input.escalationThresholdBp) {
    return "low_confidence";
  }
  return null;
}
