import { requirementAssessmentSchema, type RequirementAssessment } from "./result-contract";

export type GroundingBlock = {
  id: string;
  blockKey: string;
  canonicalText: string;
  textHash: string;
  pageNumber: number | null;
  paragraphNumber: number | null;
};

export type GroundedEvidence = RequirementAssessment["evidence"][number] & {
  documentBlockId: string;
  blockTextHash: string;
  pageNumber: number | null;
  paragraphNumber: number | null;
};

export class GroundingValidationError extends Error {
  constructor(public readonly code: "UNKNOWN_BLOCK" | "QUOTE_NOT_FOUND") {
    super(code);
    this.name = "GroundingValidationError";
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

export function validateAndGroundAssessment(
  value: unknown,
  candidateBlocks: readonly GroundingBlock[],
): { assessment: RequirementAssessment; evidence: GroundedEvidence[] } {
  const assessment = requirementAssessmentSchema.parse(value);
  const blocksByKey = new Map(candidateBlocks.map((block) => [block.blockKey, block]));

  const evidence = assessment.evidence.map((citation) => {
    const block = blocksByKey.get(citation.blockKey);
    if (!block) throw new GroundingValidationError("UNKNOWN_BLOCK");

    const quote = normalizeWhitespace(citation.exactQuote);
    const canonicalText = normalizeWhitespace(block.canonicalText);
    if (!canonicalText.includes(quote)) {
      throw new GroundingValidationError("QUOTE_NOT_FOUND");
    }

    return {
      ...citation,
      exactQuote: quote,
      documentBlockId: block.id,
      blockTextHash: block.textHash,
      pageNumber: block.pageNumber,
      paragraphNumber: block.paragraphNumber,
    };
  });

  return { assessment, evidence };
}

export function noAssessmentPossible(
  explanation: string,
  missingInformation: string[],
): RequirementAssessment {
  return requirementAssessmentSchema.parse({
    status: "no_assessment_possible",
    explanation,
    confidencePercent: 0,
    evidence: [],
    missingInformation,
  });
}
