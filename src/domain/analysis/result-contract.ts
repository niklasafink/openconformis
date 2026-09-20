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

/**
 * Der Abschlusstext einer Lücke im Profil „Wirtschaftsprüfer": eine Feststellung
 * für den Prüfungsbericht samt Auswirkung. Keine Empfehlung, kein Policy-Text.
 */
export const auditFindingSchema = z.object({
  finding: z.string().trim().min(40).max(3_000),
  riskImpact: z.array(z.string().trim().min(3).max(400)).min(1).max(4),
});

export type AuditFinding = z.infer<typeof auditFindingSchema>;

export const auditFindingJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    finding: {
      type: "string",
      minLength: 40,
      maxLength: 3000,
      description:
        "The finding for the audit report: audited subject, regulatory criterion, the deviation and the evidence it rests on.",
    },
    riskImpact: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string" },
      description: "What the deviation means for compliance, stated as short factual points.",
    },
  },
  required: ["finding", "riskImpact"],
} as const;

/**
 * Der Abschlusstext einer Lücke im Profil „Finanzinstitut": was konkret zu tun
 * ist, um die Lücke zu schließen. Maßnahmen, keine fertigen Policy-Sätze.
 */
export const remediationPlanSchema = z.object({
  gapSummary: z.string().trim().min(20).max(1_500),
  actions: z.array(z.string().trim().min(6).max(400)).min(1).max(8),
});

export type RemediationPlan = z.infer<typeof remediationPlanSchema>;

export const remediationPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    gapSummary: {
      type: "string",
      minLength: 20,
      maxLength: 1500,
      description:
        "One or two sentences naming what the policy is missing against the requirement.",
    },
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string" },
      description:
        "One concrete measure per item that closes part of the gap, each naming the mandatory aspect it covers.",
    },
  },
  required: ["gapSummary", "actions"],
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
