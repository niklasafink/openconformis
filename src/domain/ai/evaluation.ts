import { z } from "zod";

export const modelEvaluationMetricsSchema = z.object({
  repeatCount: z.number().int().min(3).max(100),
  fabricatedEvidenceCount: z.number().int().min(0),
  evidenceValidityBasisPoints: z.number().int().min(0).max(10_000),
  falsePositiveFulfilledBasisPoints: z.number().int().min(0).max(10_000),
  evidencePrecisionBasisPoints: z.number().int().min(0).max(10_000),
  evidenceRecallBasisPoints: z.number().int().min(0).max(10_000),
  macroF1BasisPoints: z.number().int().min(0).max(10_000),
  schemaReliabilityBasisPoints: z.number().int().min(0).max(10_000),
  germanRegulatoryBasisPoints: z.number().int().min(0).max(10_000),
  p95LatencyMilliseconds: z.number().int().positive().max(3_600_000),
  costMicrounitsPerRun: z.number().int().nonnegative(),
  privacyQualified: z.boolean(),
});

export type ModelEvaluationMetrics = z.infer<typeof modelEvaluationMetricsSchema>;

export function evaluateMandatoryModelThresholds(metrics: ModelEvaluationMetrics) {
  return (
    metrics.fabricatedEvidenceCount === 0 &&
    metrics.evidenceValidityBasisPoints === 10_000 &&
    metrics.falsePositiveFulfilledBasisPoints <= 500 &&
    metrics.evidencePrecisionBasisPoints >= 9_000 &&
    metrics.evidenceRecallBasisPoints >= 8_500 &&
    metrics.macroF1BasisPoints >= 8_500 &&
    metrics.schemaReliabilityBasisPoints >= 9_900 &&
    metrics.germanRegulatoryBasisPoints >= 8_500 &&
    metrics.privacyQualified
  );
}
