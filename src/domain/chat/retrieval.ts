import { lexicalTokens } from "@/domain/analysis/retrieval";
import { createContentHash } from "@/domain/frameworks/content-hash";

export type ChatSourceType = "framework_requirement" | "framework_subrequirement" | "policy_block";

/** Ein Treffer belegt eine Aussage; ein Nachbarblock trägt nur Lesekontext. */
export type ChatSourceRole = "match" | "context";

export type ChatRetrievalSource = {
  sourceType: ChatSourceType;
  requirementId?: string;
  subrequirementId?: string;
  documentBlockId?: string;
  label: string;
  locator?: string;
  text: string;
  sourceHash: string;
  /** Nur Policy-Blöcke: Position im Dokument, Grundlage des Nachbarkontexts. */
  ordinal?: number;
};

export type RankedChatSource = ChatRetrievalSource & {
  citationOrder: number;
  score: number;
  role: ChatSourceRole;
};

const maximumPolicyBlockCharacters = 2_400;
const maximumFrameworkCharacters = 6_000;

function termFrequencies(values: readonly string[]) {
  const frequencies = new Map<string, number>();
  for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  return frequencies;
}

type ScoredSource = { source: ChatRetrievalSource; score: number };

/**
 * Dieselbe BM25-Gewichtung wie die Belegsuche der Analyse, damit Chat und
 * Bewertung dieselbe Stelle eines Dokuments finden. Der Titel zählt doppelt:
 * „Art. 5 DORA" im Kopf einer Anforderung wiegt mehr als dasselbe Wort
 * irgendwo im Fließtext.
 */
function scoreSources(question: string, sources: readonly ChatRetrievalSource[]): ScoredSource[] {
  const queryTerms = [...new Set(lexicalTokens(question))];
  if (queryTerms.length === 0 || sources.length === 0) return [];

  const documents = sources.map((source) => {
    const bodyTokens = lexicalTokens(source.text);
    const labelTokens = lexicalTokens(`${source.label} ${source.locator ?? ""}`);
    return {
      source,
      length: bodyTokens.length,
      frequencies: termFrequencies([...bodyTokens, ...labelTokens, ...labelTokens]),
    };
  });
  const averageLength =
    documents.reduce((total, document) => total + document.length, 0) / documents.length || 1;
  const documentFrequencies = new Map(
    queryTerms.map((term) => [
      term,
      documents.filter((document) => document.frequencies.has(term)).length,
    ]),
  );

  return documents
    .map((document) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = document.frequencies.get(term) ?? 0;
        if (frequency === 0) continue;
        const documentFrequency = documentFrequencies.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
        );
        const normalization =
          frequency + 1.2 * (0.25 + 0.75 * (document.length / Math.max(1, averageLength)));
        score += inverseDocumentFrequency * ((frequency * 2.2) / normalization);
      }
      return { source: document.source, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.source.label.localeCompare(right.source.label, "de"),
    );
}

/**
 * Eine einzelne Quellenart ranken. Bleibt für Aufrufer erhalten, die nur ein
 * Korpus durchsuchen; die gemischte Auswahl läuft über `selectChatSources`.
 */
export function rankChatSources(
  question: string,
  sources: readonly ChatRetrievalSource[],
  limit = 8,
): RankedChatSource[] {
  return scoreSources(question, sources)
    .slice(0, Math.max(1, Math.min(limit, 12)))
    .map((entry, index) => ({
      ...entry.source,
      score: entry.score,
      role: "match" as const,
      citationOrder: index + 1,
    }));
}

export type ChatSourceSelection = {
  question: string;
  frameworkSources?: readonly ChatRetrievalSource[];
  policySources?: readonly ChatRetrievalSource[];
  frameworkLimit?: number;
  policyLimit?: number;
  /** Für wie viele der besten Policy-Treffer die Nachbarblöcke mitkommen. */
  neighbourDepth?: number;
  maximumCharacters?: number;
};

/**
 * Wählt Belege aus beiden Korpora getrennt aus, damit ein langes Dokument die
 * regulatorischen Anforderungen nicht verdrängt — und umgekehrt. Policy-Treffer
 * bekommen ihre unmittelbaren Nachbarn dazu: ein Absatz allein liest sich oft
 * anders als im Abschnitt, in dem er steht.
 */
export function selectChatSources(input: ChatSourceSelection): RankedChatSource[] {
  const frameworkLimit = input.frameworkLimit ?? 6;
  const policyLimit = input.policyLimit ?? 6;
  const neighbourDepth = input.neighbourDepth ?? 3;
  const maximumCharacters = input.maximumCharacters ?? 28_000;

  const framework = scoreSources(input.question, input.frameworkSources ?? [])
    .slice(0, frameworkLimit)
    .map((entry) => ({ ...entry.source, score: entry.score, role: "match" as const }));

  const policySources = input.policySources ?? [];
  const policyMatches = scoreSources(input.question, policySources).slice(0, policyLimit);
  const selected = new Map<string, ChatRetrievalSource & { score: number; role: ChatSourceRole }>();
  for (const match of policyMatches) {
    selected.set(match.source.sourceHash, { ...match.source, score: match.score, role: "match" });
  }
  for (const match of policyMatches.slice(0, neighbourDepth)) {
    if (match.source.ordinal === undefined) continue;
    for (const offset of [-1, 1] as const) {
      const neighbour = policySources.find(
        (source) => source.ordinal === (match.source.ordinal ?? 0) + offset,
      );
      if (!neighbour || selected.has(neighbour.sourceHash)) continue;
      selected.set(neighbour.sourceHash, {
        ...neighbour,
        score: match.score * 0.2,
        role: "context",
      });
    }
  }
  const policy = [...selected.values()].sort(
    (left, right) => (left.ordinal ?? 0) - (right.ordinal ?? 0),
  );

  const ranked: RankedChatSource[] = [];
  let characters = 0;
  for (const source of [...framework, ...policy]) {
    if (ranked.length > 0 && characters + source.text.length > maximumCharacters) continue;
    characters += source.text.length;
    ranked.push({ ...source, citationOrder: ranked.length + 1 });
  }
  return ranked;
}

export function createFrameworkChatSource(input: {
  sourceType?: "framework_requirement" | "framework_subrequirement";
  sourceId: string;
  regulatoryId: string;
  title: string;
  legalText: string;
  sourceLocator?: string | null;
}): ChatRetrievalSource {
  const text = input.legalText.trim().slice(0, maximumFrameworkCharacters);
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

/**
 * Ein geparster Dokumentblock als Beleg. Der Blockschlüssel bleibt in der
 * Fundstelle stehen: nur über ihn lässt sich eine Chatantwort später im
 * Originaldokument wiederfinden.
 */
export function createPolicyChatSource(input: {
  documentBlockId: string;
  blockKey: string;
  ordinal: number;
  canonicalText: string;
  headingPath: readonly string[];
  pageNumber?: number | null;
  paragraphNumber?: number | null;
  documentName: string;
  locale: "de" | "en";
}): ChatRetrievalSource {
  const text = input.canonicalText.trim().slice(0, maximumPolicyBlockCharacters);
  const heading = input.headingPath.filter((entry) => entry.trim().length > 0);
  const locator = [
    input.pageNumber ? `${input.locale === "de" ? "Seite" : "Page"} ${input.pageNumber}` : null,
    input.paragraphNumber
      ? `${input.locale === "de" ? "Absatz" : "Paragraph"} ${input.paragraphNumber}`
      : null,
    input.blockKey,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    sourceType: "policy_block",
    documentBlockId: input.documentBlockId,
    label: `${input.documentName} · ${heading.at(-1) ?? input.blockKey}`,
    locator,
    text,
    ordinal: input.ordinal,
    sourceHash: createContentHash({
      sourceType: "policy_block",
      sourceId: input.documentBlockId,
      text,
    }),
  };
}

function sourceKind(source: RankedChatSource) {
  return source.sourceType === "policy_block" ? "policy_document" : "framework";
}

export function renderRetrievalContext(sources: readonly RankedChatSource[]) {
  return sources
    .map((source) =>
      [
        `[${source.citationOrder}] kind=${sourceKind(source)} role=${source.role}`,
        `title: ${source.label}`,
        source.locator ? `locator: ${source.locator}` : null,
        `text: ${source.text}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}
