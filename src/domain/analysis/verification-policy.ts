import { createHash } from "node:crypto";

import type { RequirementAssessment } from "./result-contract";

export type VerificationReason =
  "fulfilled" | "not_fulfilled" | "low_confidence" | "contradiction" | "retried" | "drift_sample";

/**
 * Bewertungen mit höherer Konfidenz gelten ohne Verifikation. Die Schwelle liegt
 * bei 85, weil schnelle Modelle ihre Konfidenz höher angeben: GPT-5.6 Luna nannte
 * für „teilweise erfüllt" 75 bis 88 Prozent, wo Sonnet 55 bis 65 nannte — bei 75
 * wäre die Verifikation fast nie ausgelöst worden.
 */
const confidenceThresholdPercent = 85;

/** Anteil zufällig, aber reproduzierbar gezogener Bewertungen, die immer geprüft werden. */
const driftSamplePercent = 10;

export function verificationReasons(
  analysisId: string,
  requirementExternalKey: string,
  assessment: RequirementAssessment,
  /** Die Bewertung gelang erst im zweiten Versuch, etwa nach einem falschen Zitat. */
  options: { retried?: boolean } = {},
): VerificationReason[] {
  const reasons: VerificationReason[] = [];
  if (assessment.status === "fulfilled") reasons.push("fulfilled");
  if (assessment.status === "not_fulfilled") reasons.push("not_fulfilled");
  if (assessment.confidencePercent < confidenceThresholdPercent) reasons.push("low_confidence");
  if (assessment.evidence.some(({ support }) => support === "contradicts")) {
    reasons.push("contradiction");
  }
  if (options.retried) reasons.push("retried");

  const sampleValue = Number.parseInt(
    createHash("sha256")
      .update(`${analysisId}:${requirementExternalKey}`, "utf8")
      .digest("hex")
      .slice(0, 8),
    16,
  );
  if (sampleValue % 100 < driftSamplePercent) reasons.push("drift_sample");
  return reasons;
}

/**
 * Die Triage darf nur dort mitreden, wo „erfüllt" der **einzige** Grund ist. Trägt
 * das Ergebnis auch niedrige Konfidenz, einen Widerspruch oder die Driftstichprobe,
 * läuft das Zweitmodell ohnehin — Jev wird dann nicht einmal gefragt. Die
 * Driftstichprobe bleibt damit die unabhängige Kontrolle über Jev selbst.
 */
export function isTriageEligible(reasons: readonly VerificationReason[]) {
  return reasons.length === 1 && reasons[0] === "fulfilled";
}

/** Die Gründe nach der Triage: nur eine bestandene Triage nimmt „erfüllt" heraus. */
export function reasonsAfterTriage(
  reasons: VerificationReason[],
  waived: boolean,
): VerificationReason[] {
  return waived && isTriageEligible(reasons) ? [] : reasons;
}
