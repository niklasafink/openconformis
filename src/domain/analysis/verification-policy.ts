import { createHash } from "node:crypto";

import type { RequirementAssessment } from "./result-contract";

export type VerificationReason = "fulfilled" | "low_confidence" | "contradiction" | "drift_sample";

export function verificationReasons(
  analysisId: string,
  requirementExternalKey: string,
  assessment: RequirementAssessment,
): VerificationReason[] {
  const reasons: VerificationReason[] = [];
  if (assessment.status === "fulfilled") reasons.push("fulfilled");
  if (assessment.confidencePercent < 75) reasons.push("low_confidence");
  if (assessment.evidence.some(({ support }) => support === "contradicts")) {
    reasons.push("contradiction");
  }

  const sampleValue = Number.parseInt(
    createHash("sha256")
      .update(`${analysisId}:${requirementExternalKey}`, "utf8")
      .digest("hex")
      .slice(0, 8),
    16,
  );
  if (sampleValue % 100 < 5) reasons.push("drift_sample");
  return reasons;
}
