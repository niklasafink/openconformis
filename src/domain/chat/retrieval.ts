import { createContentHash } from "@/domain/frameworks/content-hash";

const STOP_WORDS = new Set([
  "aber",
  "als",
  "auch",
  "bei",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einer",
  "eines",
  "für",
  "ist",
  "mit",
  "nach",
  "oder",
  "sind",
  "und",
  "von",
  "was",
  "wie",
  "zu",
  "zum",
  "zur",
  "the",
  "and",
  "for",
  "from",
  "what",
  "with",
]);

export type ChatRetrievalSource = {
  sourceType: "framework_requirement" | "framework_subrequirement";
  requirementId?: string;
  subrequirementId?: string;
  label: string;
  locator?: string;
  text: string;
  sourceHash: string;
};

export type RankedChatSource = ChatRetrievalSource & {
  citationOrder: number;
  score: number;
};

function terms(value: string) {
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase("de")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length > 2 && !STOP_WORDS.has(term)),
    ),
  ];
}

export function rankChatSources(
  question: string,
  sources: readonly ChatRetrievalSource[],
  limit = 8,
): RankedChatSource[] {
  const queryTerms = terms(question);
  if (queryTerms.length === 0) return [];
  return sources
    .map((source) => {
      const normalizedLabel = source.label.toLocaleLowerCase("de");
      const sourceTerms = new Set(terms(`${source.label} ${source.text}`));
      const score = queryTerms.reduce(
        (total, term) =>
          total + (sourceTerms.has(term) ? 2 : 0) + (normalizedLabel.includes(term) ? 2 : 0),
        0,
      );
      return { ...source, score };
    })
    .filter((source) => source.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, "de"))
    .slice(0, Math.max(1, Math.min(limit, 12)))
    .map((source, index) => ({ ...source, citationOrder: index + 1 }));
}

export function createFrameworkChatSource(input: {
  sourceType?: "framework_requirement" | "framework_subrequirement";
  sourceId: string;
  regulatoryId: string;
  title: string;
  legalText: string;
  sourceLocator?: string | null;
}): ChatRetrievalSource {
  const text = input.legalText.trim().slice(0, 6_000);
  return {
    sourceType: input.sourceType ?? "framework_requirement",
    requirementId: input.sourceType === "framework_subrequirement" ? undefined : input.sourceId,
    subrequirementId: input.sourceType === "framework_subrequirement" ? input.sourceId : undefined,
    label: `${input.regulatoryId} · ${input.title}`,
    locator: input.sourceLocator?.trim() || undefined,
    text,
    sourceHash: createContentHash({
      sourceType: input.sourceType ?? "framework_requirement",
      sourceId: input.sourceId,
      text,
    }),
  };
}

export function renderRetrievalContext(sources: readonly RankedChatSource[]) {
  return sources
    .map(
      (source) =>
        `[${source.citationOrder}] ${source.label}${source.locator ? `\nFundstelle: ${source.locator}` : ""}\n${source.text}`,
    )
    .join("\n\n");
}
