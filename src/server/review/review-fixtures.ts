import type { ReviewColumnSnapshot } from "@/domain/review/column";

import type { ReviewBlock } from "./review-decision";

/**
 * Feste Testdaten für die Vertragsprüfung: ein kleiner deutscher Vertrag und drei
 * Spalten, je Spaltentyp eine. Nur von Tests importiert.
 */

export const terminationColumn: ReviewColumnSnapshot = {
  label: "Kündigung aus wichtigem Grund",
  columnType: "noul",
  instructions: "Does the contract grant a right of termination for cause?",
  criteria: {
    type: "noul",
    true: { label: "Ja, ausdrücklich geregelt", description: "The contract grants the right." },
    false: { label: "Nein oder nicht geregelt", description: "The contract is silent." },
  },
};

export const lawColumn: ReviewColumnSnapshot = {
  label: "Anwendbares Recht",
  columnType: "choice",
  instructions: "Which law governs the contract?",
  criteria: {
    type: "choice",
    options: [
      { key: "de", label: "Deutsches Recht", description: "German law governs." },
      { key: "at", label: "Österreichisches Recht", description: "Austrian law governs." },
    ],
  },
};

export const liabilityColumn: ReviewColumnSnapshot = {
  label: "Haftungsbegrenzung",
  columnType: "score",
  instructions: "How strictly is liability limited?",
  criteria: {
    type: "score",
    levels: [
      { label: "Nicht begrenzt", description: "No limitation." },
      { label: "Teilweise begrenzt", description: "Partly limited." },
      { label: "Streng begrenzt", description: "Strictly limited." },
    ],
  },
};

export const contractTexts = [
  "Dieser Vertrag unterliegt deutschem Recht unter Ausschluss des UN-Kaufrechts.",
  "Jede Partei kann den Vertrag aus wichtigem Grund fristlos kündigen. Ein wichtiger Grund liegt insbesondere bei schwerwiegender Verletzung wesentlicher Pflichten vor.",
  "Die Haftung des Anbieters ist auf den vorhersehbaren, typischen Schaden begrenzt; die Gesamthaftung ist auf die Jahresvergütung beschränkt.",
  "Änderungen dieses Vertrags bedürfen der Schriftform.",
];

export function contractBlocks(): ReviewBlock[] {
  return contractTexts.map((canonicalText, index) => ({
    documentBlockId: `00000000-0000-4000-8000-00000000000${index + 1}`,
    blockKey: `p${index + 1}`,
    ordinal: index + 1,
    canonicalText,
    tokenCount: 40,
    textHash: `hash-${index + 1}`,
    pageNumber: 1,
    paragraphNumber: index + 1,
  }));
}
