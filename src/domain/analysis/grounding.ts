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

function withFirstLetterCase(value: string, upper: boolean) {
  const first = value.charAt(0);
  return (upper ? first.toLocaleUpperCase("de") : first.toLocaleLowerCase("de")) + value.slice(1);
}

/**
 * Sucht das Zitat wörtlich im Block. Modelle schließen einen zitierten Teilsatz gern
 * als eigenen Satz ab: aus „organisiert:" wird „organisiert.", aus „die zweite
 * Linie" wird „Die zweite Linie". Genau diese zwei Abweichungen werden aufgelöst —
 * Satzzeichen am Ende und die Schreibung des ersten Buchstabens. Zurück kommt immer
 * der Wortlaut des Dokuments, nie der des Modells; alles andere bleibt ein Fehler.
 */
function locateQuote(canonicalText: string, quote: string): string | undefined {
  if (canonicalText.includes(quote)) return quote;
  const withoutEndPunctuation = quote.replace(/[.:;,!?]+$/u, "").trimEnd();
  const variants = [quote, withoutEndPunctuation].flatMap((variant) => [
    variant,
    withFirstLetterCase(variant, true),
    withFirstLetterCase(variant, false),
  ]);
  return variants.find((variant) => variant.length > 0 && canonicalText.includes(variant));
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

    const quote = locateQuote(
      normalizeWhitespace(block.canonicalText),
      normalizeWhitespace(citation.exactQuote),
    );
    if (!quote) throw new GroundingValidationError("QUOTE_NOT_FOUND");

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
