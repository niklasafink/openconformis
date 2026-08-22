import type { RankedChatSource } from "./retrieval";

const CITATION_PATTERN = /\[(\d{1,2})\]/gu;

export type ValidatedChatCitation = Pick<
  RankedChatSource,
  | "citationOrder"
  | "sourceType"
  | "requirementId"
  | "subrequirementId"
  | "label"
  | "locator"
  | "sourceHash"
> & { exactQuote: string };

export function validateChatCitations(
  content: string,
  sources: readonly RankedChatSource[],
): { content: string; citations: ValidatedChatCitation[]; valid: boolean } {
  if (sources.length === 0) return { content, citations: [], valid: false };
  const sourceByOrder = new Map(sources.map((source) => [source.citationOrder, source]));
  const referenced = [...content.matchAll(CITATION_PATTERN)].map((match) => Number(match[1]));
  if (referenced.some((citation) => !sourceByOrder.has(citation))) {
    return { content, citations: [], valid: false };
  }
  const uniqueOrders = [...new Set(referenced)];
  if (uniqueOrders.length === 0) {
    return { content, citations: [], valid: false };
  }
  return {
    content,
    valid: true,
    citations: uniqueOrders.map((order) => {
      const source = sourceByOrder.get(order)!;
      return {
        citationOrder: order,
        sourceType: source.sourceType,
        requirementId: source.requirementId,
        subrequirementId: source.subrequirementId,
        label: source.label,
        locator: source.locator,
        exactQuote: source.text,
        sourceHash: source.sourceHash,
      };
    }),
  };
}

export function unsupportedChatAnswer(locale: "de" | "en") {
  return locale === "de"
    ? "Keine belastbare Einschätzung möglich. Die Antwort konnte nicht eindeutig mit den ausgewählten regulatorischen Quellen belegt werden."
    : "No reliable assessment is possible. The answer could not be supported unambiguously by the selected regulatory sources.";
}
