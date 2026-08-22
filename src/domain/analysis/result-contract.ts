import { z } from "zod";

export const assessmentStatusSchema = z.enum([
  "fulfilled",
  "partially_fulfilled",
  "not_fulfilled",
  "not_applicable",
  "no_assessment_possible",
]);

export const assessmentEvidenceSchema = z.object({
  blockKey: z.string().trim().min(1).max(160),
  exactQuote: z.string().trim().min(8).max(1_500),
  support: z.enum(["supports", "contradicts", "context"]),
});

export const requirementAssessmentSchema = z
  .object({
    status: assessmentStatusSchema,
    explanation: z.string().trim().min(20).max(6_000),
    confidencePercent: z.number().int().min(0).max(100),
    evidence: z.array(assessmentEvidenceSchema).max(12),
    missingInformation: z.array(z.string().trim().min(3).max(500)).max(12),
  })
  .superRefine((assessment, context) => {
    if (assessment.status === "no_assessment_possible") {
      if (assessment.missingInformation.length === 0) {
        context.addIssue({
          code: "custom",
          message: "A non-assessable result must name the missing information.",
          path: ["missingInformation"],
        });
      }
      if (assessment.confidencePercent > 50) {
        context.addIssue({
          code: "custom",
          message: "A non-assessable result cannot claim high confidence.",
          path: ["confidencePercent"],
        });
      }
    }

    if (
      ["fulfilled", "partially_fulfilled", "not_fulfilled"].includes(assessment.status) &&
      assessment.evidence.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "A substantive assessment requires at least one policy citation.",
        path: ["evidence"],
      });
    }

    if (
      assessment.status === "fulfilled" &&
      assessment.evidence.some(({ support }) => support === "contradicts")
    ) {
      context.addIssue({
        code: "custom",
        message: "A fulfilled result cannot contain contradictory evidence.",
        path: ["evidence"],
      });
    }

    if (
      assessment.status === "not_fulfilled" &&
      !assessment.evidence.some(({ support }) => support === "contradicts")
    ) {
      context.addIssue({
        code: "custom",
        message: "A not-fulfilled result requires explicit contradictory policy evidence.",
        path: ["evidence"],
      });
    }

    const evidenceKeys = assessment.evidence.map(
      ({ blockKey, exactQuote }) => `${blockKey}\u0000${exactQuote}`,
    );
    if (new Set(evidenceKeys).size !== evidenceKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Duplicate evidence citations are not allowed.",
        path: ["evidence"],
      });
    }
  });

export type RequirementAssessment = z.infer<typeof requirementAssessmentSchema>;

export const requirementAssessmentJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: [
        "fulfilled",
        "partially_fulfilled",
        "not_fulfilled",
        "not_applicable",
        "no_assessment_possible",
      ],
      description:
        "Use no_assessment_possible whenever the supplied evidence cannot support a reliable conclusion.",
    },
    explanation: {
      type: "string",
      minLength: 20,
      maxLength: 6000,
      description: "A concise assessment that distinguishes facts, gaps, and missing information.",
    },
    confidencePercent: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Confidence in the conclusion based only on supplied context and citations.",
    },
    evidence: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          blockKey: {
            type: "string",
            description: "An unchanged block key from the supplied evidence candidates.",
          },
          exactQuote: {
            type: "string",
            description: "A verbatim quote copied from that block.",
          },
          support: {
            type: "string",
            enum: ["supports", "contradicts", "context"],
          },
        },
        required: ["blockKey", "exactQuote", "support"],
      },
    },
    missingInformation: {
      type: "array",
      maxItems: 12,
      items: { type: "string" },
      description: "Concrete information needed to reach a reliable conclusion.",
    },
  },
  required: ["status", "explanation", "confidencePercent", "evidence", "missingInformation"],
} as const;

export const verificationResultSchema = z.object({
  verdict: z.enum(["confirm", "reject", "uncertain"]),
  explanation: z.string().trim().min(20).max(4_000),
  unsupportedClaims: z.array(z.string().trim().min(3).max(500)).max(12),
  missingMandatoryAspects: z.array(z.string().trim().min(3).max(500)).max(12),
});

export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const verificationResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["confirm", "reject", "uncertain"] },
    explanation: { type: "string", minLength: 20, maxLength: 4000 },
    unsupportedClaims: {
      type: "array",
      maxItems: 12,
      items: { type: "string" },
    },
    missingMandatoryAspects: {
      type: "array",
      maxItems: 12,
      items: { type: "string" },
    },
  },
  required: ["verdict", "explanation", "unsupportedClaims", "missingMandatoryAspects"],
} as const;
