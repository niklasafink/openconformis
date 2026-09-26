/**
 * Richtungswörter des Plausichecks: Aussagen wie „stieg“, „verringerte sich“ oder
 * „unverändert“, die eine Veränderung behaupten. Die Prüfung vergleicht sie später
 * mit dem Vorzeichen der zugehörigen Zahlen; hier werden sie nur gefunden.
 */
/** v2: dieselbe Tabelle trägt auch die Jahreszahlen des Fließtexts (`years.ts`). */
export const statementExtractionVersion = "disclosure-statements-v2";

export type Direction = "up" | "down" | "flat";

export type RecognizedStatement = {
  start: number;
  end: number;
  raw: string;
  direction: Direction;
};

const upWords = [
  "gestiegen",
  "stiegen",
  "stieg",
  "steigt",
  "steigen",
  "erhöhten sich",
  "erhöhte sich",
  "erhöht sich",
  "erhöhten",
  "erhöhte",
  "erhöht",
  "Erhöhung",
  "Anstieg",
  "verbesserte sich",
  "verbessert",
  "zunahm",
  "nahm zu",
  "zugenommen",
  "Zunahme",
  "Zuwachs",
];

const downWords = [
  "gesunken",
  "sanken",
  "sank",
  "sinkt",
  "sinken",
  "verringerten sich",
  "verringerte sich",
  "verringert sich",
  "verringerte",
  "verringert",
  "Verringerung",
  "verminderte sich",
  "verminderten sich",
  "vermindert",
  "Verminderung",
  "reduzierte sich",
  "reduzierten sich",
  "reduziert",
  "Reduzierung",
  "fielen",
  "fiel",
  "gefallen",
  "rückläufig",
  "rückläufiger",
  "rückläufige",
  "zurückgegangen",
  "zurückging",
  "Rückgang",
  "verschlechterte sich",
  "verschlechtert",
  "abgenommen",
  "Abnahme",
];

const flatWords = ["unverändert", "Vorjahresniveau", "auf Vorjahreshöhe"];

const entries = [
  ...upWords.map((word) => ({ word, direction: "up" as const })),
  ...downWords.map((word) => ({ word, direction: "down" as const })),
  ...flatWords.map((word) => ({ word, direction: "flat" as const })),
].sort((a, b) => b.word.length - a.word.length);

const pattern = new RegExp(
  `(?<![\\p{L}-])(${entries.map((entry) => entry.word.replace(/\s+/gu, "\\s+")).join("|")})(?![\\p{L}])`,
  "giu",
);

/** Findet Richtungswörter in Fließtext; Tabellenzellen tragen Posten, keine Aussagen. */
export function recognizeStatements(text: string, blockType: string): RecognizedStatement[] {
  if (blockType === "table_cell" || blockType === "heading") return [];
  const found: RecognizedStatement[] = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const normalized = raw.replace(/\s+/gu, " ").toLowerCase();
    const entry = entries.find((candidate) => candidate.word.toLowerCase() === normalized);
    if (!entry) continue;
    // „Erhöhung (i.Vj. Verminderung) des Bestands“ ist ein GuV-Posten, keine Aussage.
    const after = text.slice(match.index + raw.length, match.index + raw.length + 8);
    const before = text.slice(Math.max(0, match.index - 8), match.index);
    if (/\(i\.\s?Vj\./u.test(after) || /\(i\.\s?Vj\.\s*$/u.test(before)) {
      continue;
    }
    found.push({
      start: match.index,
      end: match.index + raw.length,
      raw,
      direction: entry.direction,
    });
  }
  return found;
}
