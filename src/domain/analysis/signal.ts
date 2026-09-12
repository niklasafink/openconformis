import {
  createRetrievalPacket,
  lexicalTokens,
  type RetrievalBlock,
  type RetrievalRequirement,
} from "./retrieval";

/**
 * Ampel der Vorab-Einschätzung. Sie ist ausdrücklich **keine** Bewertung: sie
 * misst nur, wie viele Prüfaspekte einer Anforderung im Dokument überhaupt
 * wörtlich vorkommen. Die regulatorische Bewertung trifft weiterhin allein der
 * Modelllauf, den der Nutzer mit seinem eigenen Schlüssel startet.
 */
export type SignalLevel = "strong" | "partial" | "weak";

export type SignalHit = {
  documentBlockId: string;
  ordinal: number;
  /** Exakter Teilstring des unveränderten Dokumentblocks. */
  excerpt: string;
  headingPath: string[];
  pageNumber: number | null;
  paragraphNumber: number | null;
  matchedTerms: string[];
};

export type RequirementSignal = {
  version: "lexical-signal-v1";
  requirementExternalKey: string;
  level: SignalLevel;
  /** Anteil der Prüfaspekte mit Fundstelle, 0–100. */
  coveragePercent: number;
  coveredAspects: string[];
  openAspects: string[];
  hits: SignalHit[];
};

export type SignalOptions = {
  /** Höchstzahl der Fundstellen, die zur Anforderung angezeigt werden. */
  maximumHits?: number;
  /** Anteil der Aspekt-Tokens, ab dem ein Absatz den Aspekt abdeckt. */
  aspectCoverageThreshold?: number;
};

const strongThreshold = 0.66;
const partialThreshold = 0.33;
const maximumExcerptLength = 260;

function aspectsOf(requirement: RetrievalRequirement) {
  const aspects = [
    requirement.title,
    ...requirement.assessmentAspects,
    ...requirement.subrequirements.flatMap((subrequirement) => [
      subrequirement.title,
      ...subrequirement.assessmentAspects,
    ]),
  ];

  // Gleichlautende Aspekte aus Anforderung und Subanforderung dürfen die
  // Abdeckung nicht doppelt zählen.
  return [...new Set(aspects.map((aspect) => aspect.trim()).filter(Boolean))];
}

/**
 * Schneidet um den ersten Treffer herum an Satzgrenzen. Der Ausschnitt wird aus
 * dem Originaltext geschnitten und bleibt damit ein exakter Teilstring des
 * Blocks — nur so passt er später zur Hervorhebung im Dokument.
 */
function excerptAround(text: string, terms: readonly string[]) {
  if (text.length <= maximumExcerptLength) return text;

  const lowerText = text.toLocaleLowerCase("de");
  const firstTermIndex = terms
    .map((term) => lowerText.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (firstTermIndex === undefined) return `${text.slice(0, maximumExcerptLength).trimEnd()}…`;

  const sentenceStart = Math.max(0, text.lastIndexOf(". ", firstTermIndex) + 1);
  const start =
    firstTermIndex - sentenceStart > maximumExcerptLength ? firstTermIndex : sentenceStart;
  const end = Math.min(text.length, start + maximumExcerptLength);
  const sentenceEnd = text.indexOf(". ", firstTermIndex);
  const cut = sentenceEnd >= 0 && sentenceEnd + 1 <= end ? sentenceEnd + 1 : end;
  const excerpt = text.slice(start, cut).trim();
  return excerpt.length === 0 ? text.slice(0, maximumExcerptLength) : excerpt;
}

/**
 * Berechnet die Vorab-Einschätzung einer Anforderung gegen ein Dokument.
 *
 * Rein lexikalisch und damit ohne Modellaufruf, ohne Schlüssel und ohne Kosten:
 * das Ergebnis steht sofort und kann angezeigt werden, während der eigentliche
 * Lauf noch läuft oder noch gar nicht gestartet wurde.
 */
export function createRequirementSignal(
  requirement: RetrievalRequirement,
  blocks: readonly RetrievalBlock[],
  options: SignalOptions = {},
): RequirementSignal {
  const maximumHits = options.maximumHits ?? 4;
  const aspectCoverageThreshold = options.aspectCoverageThreshold ?? 0.5;
  const packet = createRetrievalPacket(requirement, blocks, {
    maximumMatches: Math.max(maximumHits, 6),
    maximumBlocks: Math.max(maximumHits, 6),
  });
  const matches = packet.candidates.filter((candidate) => candidate.role === "match");
  const matchTokenSets = matches.map(
    (candidate) =>
      new Set([
        ...lexicalTokens(candidate.canonicalText),
        ...lexicalTokens(candidate.headingPath.join(" ")),
      ]),
  );

  const coveredAspects: string[] = [];
  const openAspects: string[] = [];
  for (const aspect of aspectsOf(requirement)) {
    const aspectTokens = [...new Set(lexicalTokens(aspect))];
    if (aspectTokens.length === 0) continue;
    const bestShare = matchTokenSets.reduce((best, blockTokens) => {
      const hits = aspectTokens.filter((token) => blockTokens.has(token)).length;
      return Math.max(best, hits / aspectTokens.length);
    }, 0);
    (bestShare >= aspectCoverageThreshold ? coveredAspects : openAspects).push(aspect);
  }

  const assessedAspectCount = coveredAspects.length + openAspects.length;
  const coverage = assessedAspectCount === 0 ? 0 : coveredAspects.length / assessedAspectCount;

  return {
    version: "lexical-signal-v1",
    requirementExternalKey: requirement.externalKey,
    level:
      coverage >= strongThreshold ? "strong" : coverage >= partialThreshold ? "partial" : "weak",
    coveragePercent: Math.round(coverage * 100),
    coveredAspects,
    openAspects,
    hits: matches.slice(0, maximumHits).map((candidate) => ({
      documentBlockId: candidate.id,
      ordinal: candidate.ordinal,
      excerpt: excerptAround(candidate.canonicalText, candidate.matchedTerms),
      headingPath: candidate.headingPath,
      pageNumber: candidate.pageNumber,
      paragraphNumber: candidate.paragraphNumber,
      matchedTerms: candidate.matchedTerms,
    })),
  };
}
