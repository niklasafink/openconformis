import { createContentHash } from "@/domain/frameworks/content-hash";

const stopWords = new Set([
  "aber",
  "alle",
  "also",
  "auch",
  "auf",
  "aus",
  "bei",
  "das",
  "dem",
  "den",
  "der",
  "des",
  "die",
  "durch",
  "ein",
  "eine",
  "einer",
  "eines",
  "für",
  "hat",
  "ist",
  "mit",
  "nach",
  "oder",
  "sich",
  "sie",
  "sind",
  "und",
  "von",
  "werden",
  "wird",
  "zur",
  "the",
  "and",
  "for",
  "from",
  "into",
  "that",
  "this",
  "with",
]);

export type RetrievalBlock = {
  id: string;
  blockKey: string;
  ordinal: number;
  canonicalText: string;
  headingPath: string[];
  tokenCount: number | null;
  textHash: string;
  pageNumber: number | null;
  paragraphNumber: number | null;
};

export type RetrievalRequirement = {
  externalKey: string;
  regulatoryId: string;
  title: string;
  legalText: string;
  assessmentAspects: string[];
  sizeGuidance: string;
  subrequirements: Array<{
    regulatoryId: string;
    title: string;
    legalText: string;
    assessmentAspects: string[];
  }>;
};

export type RetrievalCandidate = RetrievalBlock & {
  rank: number;
  score: number;
  scoreBasisPoints: number;
  role: "match" | "context_before" | "context_after";
  matchedTerms: string[];
};

export type RetrievalPacket = {
  version: "lexical-bm25-v1";
  requirementExternalKey: string;
  candidates: RetrievalCandidate[];
  tokenCount: number;
  inputHash: string;
  outputHash: string;
};

export type RetrievalOptions = {
  maximumMatches?: number;
  maximumBlocks?: number;
  maximumTokens?: number;
  minimumScore?: number;
};

function tokens(value: string) {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("de")
      .match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,}/gu)
      ?.map((token) => token.replace(/^-|-$/gu, ""))
      .filter((token) => token.length >= 3 && !stopWords.has(token)) ?? []
  );
}

function normalizedPhrase(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("de").replace(/\s+/gu, " ").trim();
}

function termFrequencies(values: string[]) {
  const frequencies = new Map<string, number>();
  for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  return frequencies;
}

function weightedQueryTerms(requirement: RetrievalRequirement) {
  const weights = new Map<string, number>();
  const add = (value: string, weight: number) => {
    for (const token of tokens(value)) weights.set(token, (weights.get(token) ?? 0) + weight);
  };

  add(requirement.title, 4);
  add(requirement.legalText, 1);
  add(requirement.sizeGuidance, 1.25);
  requirement.assessmentAspects.forEach((aspect) => add(aspect, 3));
  requirement.subrequirements.forEach((subrequirement) => {
    add(subrequirement.title, 2);
    add(subrequirement.legalText, 0.5);
    subrequirement.assessmentAspects.forEach((aspect) => add(aspect, 1.5));
  });

  return weights;
}

function candidateTokenCount(block: RetrievalBlock) {
  return block.tokenCount ?? tokens(block.canonicalText).length;
}

export function createRetrievalPacket(
  requirement: RetrievalRequirement,
  blocks: readonly RetrievalBlock[],
  options: RetrievalOptions = {},
): RetrievalPacket {
  const maximumMatches = options.maximumMatches ?? 8;
  const maximumBlocks = options.maximumBlocks ?? 16;
  const maximumTokens = options.maximumTokens ?? 6_000;
  const minimumScore = options.minimumScore ?? 0.75;
  const queryTerms = weightedQueryTerms(requirement);
  const documents = blocks.map((block) => {
    const bodyTokens = tokens(block.canonicalText);
    const headingTokens = tokens(block.headingPath.join(" "));
    return {
      block,
      bodyTokens,
      frequencies: termFrequencies([...bodyTokens, ...headingTokens, ...headingTokens]),
    };
  });
  const averageLength =
    documents.reduce((total, document) => total + document.bodyTokens.length, 0) /
    Math.max(1, documents.length);
  const documentFrequencies = new Map<string, number>();
  for (const term of queryTerms.keys()) {
    documentFrequencies.set(
      term,
      documents.filter((document) => document.frequencies.has(term)).length,
    );
  }

  const phrases = [requirement.title, ...requirement.assessmentAspects]
    .map(normalizedPhrase)
    .filter((phrase) => phrase.length >= 12);
  const scored = documents
    .map(({ block, bodyTokens, frequencies }) => {
      let score = 0;
      const matchedTerms: string[] = [];
      for (const [term, queryWeight] of queryTerms) {
        const frequency = frequencies.get(term) ?? 0;
        if (frequency === 0) continue;
        matchedTerms.push(term);
        const documentFrequency = documentFrequencies.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
        );
        const normalization =
          frequency + 1.2 * (0.25 + 0.75 * (bodyTokens.length / Math.max(1, averageLength)));
        score += queryWeight * inverseDocumentFrequency * ((frequency * 2.2) / normalization);
      }

      const normalizedText = normalizedPhrase(
        `${block.headingPath.join(" ")} ${block.canonicalText}`,
      );
      score += phrases.filter((phrase) => normalizedText.includes(phrase)).length * 3;
      return { block, score, matchedTerms: matchedTerms.sort() };
    })
    .filter(({ score }) => score >= minimumScore)
    .sort((left, right) => right.score - left.score || left.block.ordinal - right.block.ordinal)
    .slice(0, maximumMatches);

  const selected = new Map<
    string,
    {
      block: RetrievalBlock;
      score: number;
      role: RetrievalCandidate["role"];
      matchedTerms: string[];
    }
  >();
  for (const match of scored) {
    selected.set(match.block.id, { ...match, role: "match" });
    for (const offset of [-1, 1] as const) {
      const neighbour = blocks.find((block) => block.ordinal === match.block.ordinal + offset);
      if (!neighbour || selected.has(neighbour.id)) continue;
      selected.set(neighbour.id, {
        block: neighbour,
        score: match.score * 0.2,
        role: offset < 0 ? "context_before" : "context_after",
        matchedTerms: [],
      });
    }
  }

  const maximumScore = Math.max(1, ...[...selected.values()].map(({ score }) => score));
  let tokenCount = 0;
  const candidates: RetrievalCandidate[] = [];
  for (const candidate of [...selected.values()].sort(
    (left, right) => right.score - left.score || left.block.ordinal - right.block.ordinal,
  )) {
    if (candidates.length >= maximumBlocks) break;
    const blockTokens = candidateTokenCount(candidate.block);
    if (tokenCount + blockTokens > maximumTokens) continue;
    tokenCount += blockTokens;
    candidates.push({
      ...candidate.block,
      rank: candidates.length + 1,
      score: candidate.score,
      scoreBasisPoints: Math.round((candidate.score / maximumScore) * 10_000),
      role: candidate.role,
      matchedTerms: candidate.matchedTerms,
    });
  }

  const inputHash = createContentHash({
    version: "lexical-bm25-v1",
    requirement,
    blocks: blocks.map(({ id, blockKey, ordinal, textHash }) => ({
      id,
      blockKey,
      ordinal,
      textHash,
    })),
    options: { maximumMatches, maximumBlocks, maximumTokens, minimumScore },
  });
  const outputHash = createContentHash({
    inputHash,
    candidates: candidates.map(
      ({ id, blockKey, rank, scoreBasisPoints, role, matchedTerms, textHash }) => ({
        id,
        blockKey,
        rank,
        scoreBasisPoints,
        role,
        matchedTerms,
        textHash,
      }),
    ),
    tokenCount,
  });

  return {
    version: "lexical-bm25-v1",
    requirementExternalKey: requirement.externalKey,
    candidates,
    tokenCount,
    inputHash,
    outputHash,
  };
}
