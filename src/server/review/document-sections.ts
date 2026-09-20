import { blockTokenCount, type BudgetBlock } from "@/server/ai/system-one-budget";

/**
 * Der Vertrag, zerlegt in Abschnitte für das Belegrouting.
 *
 * Die Abschnittsgrösse bestimmt Kosten *und* Trennschärfe. Ein Abschnitt von rund
 * 2 000 Token ist klein genug, dass „relevant" noch etwas über einzelne Klauseln
 * aussagt, und gross genug, dass ein 40 000-Token-Vertrag mit etwa zwanzig Anfragen
 * abgedeckt ist statt mit Hunderten. Alle Spalten bewerten denselben Abschnitt in
 * *einem* Request — ungebündelt wären es bei zwanzig Spalten zwanzigmal so viele.
 */

export const defaultSectionTokenTarget = 2_000;

export type DocumentSection = {
  /** Fortlaufend ab 0; geht in den Batch-Schlüssel ein. */
  index: number;
  blockKeys: string[];
  tokenCount: number;
};

/**
 * Gruppiert die Blöcke in Dokumentreihenfolge. Blöcke werden nie geteilt: ein halber
 * Block ergäbe ein Zitat, das im Originaldokument so nicht steht. Ein Block, der
 * allein grösser als das Ziel ist, bekommt seinen eigenen Abschnitt.
 */
export function splitIntoSections(
  blocks: readonly BudgetBlock[],
  sectionTokenTarget: number = defaultSectionTokenTarget,
): DocumentSection[] {
  const target = Math.max(1, Math.floor(sectionTokenTarget));
  const sections: DocumentSection[] = [];
  let current: DocumentSection | undefined;

  for (const block of blocks) {
    const cost = blockTokenCount(block);
    if (!current || (current.tokenCount > 0 && current.tokenCount + cost > target)) {
      current = { index: sections.length, blockKeys: [], tokenCount: 0 };
      sections.push(current);
    }
    current.blockKeys.push(block.blockKey);
    current.tokenCount += cost;
  }

  return sections;
}
