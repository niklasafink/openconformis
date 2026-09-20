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

/**
 * Das Urteil einer Zelle aus den Urteilen ihrer Belege.
 *
 * `worstCitationVerdict` (das strengste Urteil gewinnt) wäre für die Zelle zu grob:
 * eine Stelle, die zum Thema nur schweigt, macht eine Antwort nicht fragwürdig, wenn
 * eine andere sie stützt. Deshalb gilt hier:
 *
 * - ein erfundenes Zitat entscheidet immer — die Zelle wird nie still „fertig";
 * - ein Widerspruch macht sie prüfbedürftig, auch wenn andere Stellen stützen;
 * - sonst genügt **eine** tragende Stelle oberhalb der Schwelle;
 * - ohne tragende Stelle (auch ohne jeden Beleg) ist die Antwort „nicht belegt".
 */
export function cellCitationOutcome(
  checks: readonly CitationCheck[],
  acceptThresholdBp: number = defaultCitationAcceptThresholdBp,
): { verdict: CitationVerdict; needsReview: boolean } {
  if (checks.some((check) => check.verdict === "fabricated")) {
    return { verdict: "fabricated", needsReview: true };
  }
  if (checks.some((check) => check.verdict === "contradicted")) {
    return { verdict: "contradicted", needsReview: true };
  }
  const supporting = checks.filter((check) => check.verdict === "verified");
  if (supporting.length === 0) return { verdict: "unsupported", needsReview: true };
  const best = Math.max(...supporting.map((check) => check.confidenceBp));
  return { verdict: "verified", needsReview: best < acceptThresholdBp };
}

/**
 * Ein Zitat für Anzeige und Prüfung: der ganze Block, wenn er kurz ist, sonst sein
 * Anfang bis zum letzten Satzende oder Leerzeichen vor der Grenze. Immer ein exakter
 * Substring des normalisierten Blocktextes, nie eine Umschreibung — Jev gibt keinen
 * Text zurück, das Zitat wählt also der Code.
 */
export function citationExcerpt(canonicalText: string, maximumCharacters: number = 600): string {
  const normalized = normalizeQuote(canonicalText);
  if (normalized.length <= maximumCharacters) return normalized;
  const window = normalized.slice(0, maximumCharacters);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("; "),
    window.lastIndexOf(": "),
  );
  if (sentenceEnd >= maximumCharacters / 3) return window.slice(0, sentenceEnd + 1).trim();
  const space = window.lastIndexOf(" ");
  return (space > 0 ? window.slice(0, space) : window).trim();
}
