/**
 * Jahreszahlen im Fließtext eines Berichts. Sie sind keine Berichtszahlen und werden
 * nicht hervorgehoben; die Vortragsprüfung braucht sie aber als Gegenstand, wenn beim
 * Fortschreiben des Vorjahresberichts ein Jahr stehen geblieben ist. Normzitate
 * („Nr. 575/2013“, „(EU) 2024/1623“) und Aktenzeichen sind keine Jahresangaben.
 */

export type RecognizedYear = {
  start: number;
  end: number;
  raw: string;
  year: number;
};

const yearPattern = /(?<![\p{L}\d/.,-])((?:19|20)\d{2})(?![\d/]|[.,]\d)/gu;
const citationBefore = /(?:\bNr\.?|\bNo\.?|\(EU\)|\(EG\)|\(EWG\)|Richtlinie|Verordnung|\/)\s*$/u;

export function recognizeYears(text: string, blockType: string): RecognizedYear[] {
  if (blockType === "table_cell") return [];
  const found: RecognizedYear[] = [];
  for (const match of text.matchAll(yearPattern)) {
    const before = text.slice(Math.max(0, match.index - 16), match.index);
    if (citationBefore.test(before)) continue;
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      year: Number(match[1]),
    });
  }
  return found;
}
