import type { SystemOneAnswer } from "@/domain/ai/system-one";

/**
 * Zweistufige Zitatprüfung.
 *
 * Stufe eins ist ein exakter Substring-Vergleich gegen den unveränderlichen
 * Dokumentblock. Er beweist, dass das Zitat im Dokument **steht** — mehr nicht. Ein
 * erfundenes Zitat scheitert hier, ohne dass ein einziges Modell gefragt wird; das
 * ist zugleich die billigste und die härteste der beiden Stufen.
 *
 * Stufe zwei schliesst die verbleibende Lücke: ein Zitat kann wörtlich im Vertrag
 * stehen und die Behauptung trotzdem nicht tragen oder ihr sogar widersprechen.
 */

export type CitationBlock = {
  documentBlockId: string;
  blockKey: string;
  canonicalText: string;
  textHash: string;
  pageNumber: number | null;
  paragraphNumber: number | null;
};

export type CitationVerdict = "verified" | "contradicted" | "unsupported" | "fabricated";

export function normalizeQuote(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

export type GroundedCitation = {
  quote: string;
  block: CitationBlock;
};

/**
 * Stufe eins. Gibt `undefined` zurück, wenn das Zitat so nicht im Block steht — der
 * Aufrufer setzt die Zelle dann auf `fabricated`, ohne zu fragen.
 */
export function groundCitation(
  quote: string,
  block: CitationBlock | undefined,
): GroundedCitation | undefined {
  if (!block) return undefined;
  const normalized = normalizeQuote(quote);
  if (!normalized) return undefined;
  if (!normalizeQuote(block.canonicalText).includes(normalized)) return undefined;
  return { quote: normalized, block };
}

export type CitationCheck = {
  verdict: CitationVerdict;
  confidenceBp: number;
  /**
   * Eine Zelle mit Prüfbedarf bekommt kein stilles Ergebnis. Sie eskaliert oder
   * landet sichtbar auf „Prüfung nötig" — nie auf einem ruhigen „erfüllt".
   */
  needsReview: boolean;
};

export const defaultCitationAcceptThresholdBp = 8_000;

/**
 * Stufe zwei. Nur ein „stützt" **oberhalb** der Schwelle gilt ohne Zweitmeinung.
 * „Widerspricht" ist immer prüfbedürftig, auch bei hoher Konfidenz — gerade dann.
 */
export function citationCheckFromAnswer(
  answer: SystemOneAnswer,
  acceptThresholdBp: number = defaultCitationAcceptThresholdBp,
): CitationCheck {
  if (answer.type !== "choice") {
    return { verdict: "unsupported", confidenceBp: 0, needsReview: true };
  }

  const confidenceBp = Math.round(Math.min(Math.max(answer.confidence, 0), 1) * 10_000);

  if (answer.choice === "contradicts") {
    return { verdict: "contradicted", confidenceBp, needsReview: true };
  }
  if (answer.choice === "supports") {
    return {
      verdict: "verified",
      confidenceBp,
      needsReview: confidenceBp < acceptThresholdBp,
    };
  }
  return { verdict: "unsupported", confidenceBp, needsReview: true };
}

/** Das strengste Urteil einer Belegliste bestimmt das Urteil der Zelle. */
export function worstCitationVerdict(
  verdicts: readonly CitationVerdict[],
): CitationVerdict | undefined {
  const order: CitationVerdict[] = ["fabricated", "contradicted", "unsupported", "verified"];
  for (const verdict of order) {
    if (verdicts.includes(verdict)) return verdict;
  }
  return undefined;
}
