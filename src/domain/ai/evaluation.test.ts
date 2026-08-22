import { describe, expect, it } from "vitest";

import { evaluateMandatoryModelThresholds } from "./evaluation";

const passing = {
  repeatCount: 3,
  fabricatedEvidenceCount: 0,
  evidenceValidityBasisPoints: 10_000,
  falsePositiveFulfilledBasisPoints: 500,
  evidencePrecisionBasisPoints: 9_000,
  evidenceRecallBasisPoints: 8_500,
  macroF1BasisPoints: 8_500,
  schemaReliabilityBasisPoints: 9_900,
  germanRegulatoryBasisPoints: 8_500,
  p95LatencyMilliseconds: 10_000,
  costMicrounitsPerRun: 100,
  privacyQualified: true,
};

describe("mandatory model evaluation thresholds", () => {
  it("certifies only a model that passes every safety and quality gate", () => {
    expect(evaluateMandatoryModelThresholds(passing)).toBe(true);
    expect(evaluateMandatoryModelThresholds({ ...passing, fabricatedEvidenceCount: 1 })).toBe(
      false,
    );
    expect(
      evaluateMandatoryModelThresholds({ ...passing, falsePositiveFulfilledBasisPoints: 501 }),
    ).toBe(false);
    expect(evaluateMandatoryModelThresholds({ ...passing, privacyQualified: false })).toBe(false);
  });
});
