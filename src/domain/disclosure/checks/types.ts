import type { Direction } from "../statements";
import type { FigureUnit, PeriodHint } from "../figures";

/**
 * Eingaben und Ergebnisse der deterministischen Prüfungen des Plausichecks. Alles hier
 * ist rein: dieselben erkannten Zahlen ergeben dieselben Prüfungen, ohne Datenbank und
 * ohne Modell. Beträge sind `bigint` in Millionstel der Grundeinheit.
 */

export const checkEngineVersion = "disclosure-checks-v2";

export type EngineBlock = Readonly<{
  id: string;
  ordinal: number;
  type: string;
  text: string;
  page: number | null;
  tz: string | null;
  technical: boolean;
  table: Readonly<{
    index: number;
    row: number;
    column: number;
    header: boolean;
    rowLabel: string | null;
    columnLabel: string | null;
    caption: string | null;
  }> | null;
}>;

export type EngineFigure = Readonly<{
  id: string;
  blockId: string;
  start: number;
  end: number;
  raw: string;
  micro: bigint | null;
  displayUnit: bigint;
  unit: FigureUnit;
  scale: number;
  decimals: number;
  period: PeriodHint | null;
  parenthesized: boolean;
  issue: string | null;
}>;

export type EngineStatement = Readonly<{
  id: string;
  blockId: string;
  start: number;
  end: number;
  raw: string;
  direction: Direction;
}>;

/** Eine Jahreszahl im Fließtext; Gegenstand nur der Vortragsprüfung. */
export type EngineYear = Readonly<{
  id: string;
  blockId: string;
  start: number;
  end: number;
  raw: string;
  year: number;
}>;

export type EngineDocument = Readonly<{
  blocks: readonly EngineBlock[];
  figures: readonly EngineFigure[];
  statements: readonly EngineStatement[];
  /** Fehlt bei Erkennungen vor den Jahreszahlen; dann gibt es keine Vortragsprüfung. */
  years?: readonly EngineYear[];
  reportYear: number | null;
}>;

export type CheckKind =
  | "sentence_arithmetic"
  | "direction"
  | "table_sum"
  | "balance"
  | "horizontal_sum"
  | "change_column"
  | "cross_reference"
  | "prior_year"
  | "derived"
  | "ratio"
  | "evidence"
  | "rollover"
  | "prior_report";

export const checkKinds: readonly CheckKind[] = [
  "sentence_arithmetic",
  "direction",
  "table_sum",
  "balance",
  "horizontal_sum",
  "change_column",
  "cross_reference",
  "prior_year",
  "derived",
  "ratio",
  "evidence",
  "rollover",
  "prior_report",
];

export type CheckStatus = "match" | "mismatch" | "uncertain";

export type CommentCode =
  | "sum_matches"
  | "sum_differs"
  | "sum_ambiguous"
  | "balance_matches"
  | "balance_differs"
  | "horizontal_matches"
  | "horizontal_differs"
  | "horizontal_incomplete"
  | "change_matches"
  | "change_differs"
  | "arithmetic_matches"
  | "arithmetic_differs"
  | "direction_matches"
  | "direction_contradicts"
  | "direction_unclear"
  | "reference_matches"
  | "reference_differs"
  | "reference_sign"
  | "reference_candidates"
  | "reference_structure"
  | "prior_matches"
  | "prior_differs"
  | "prior_ambiguous"
  | "derived_matches"
  | "derived_differs"
  | "ratio_matches"
  | "ratio_differs"
  | "model_unsure"
  | "evidence_matches"
  | "evidence_differs"
  | "year_suspect"
  | "year_not_rolled"
  | "prior_report_matches"
  | "prior_report_differs";

export type CheckComment = Readonly<{
  code: CommentCode;
  params: Readonly<Record<string, string>>;
}>;

/** Eine Prüfung, wie der Lauf sie speichert. `sourceKey` macht sie im Lauf eindeutig. */
export type CheckDraft = {
  kind: CheckKind;
  status: CheckStatus;
  subjectFigureId: string | null;
  subjectStatementId: string | null;
  actual: bigint | null;
  expected: bigint | null;
  tolerance: bigint | null;
  rounded: boolean;
  sourceKind: "table" | "text" | "formula" | "evidence" | "prior_report";
  sourceFigureIds: string[];
  sourceBlockIds: string[];
  /** Konten einer Belegdatei (SuSa), gegen die geprüft wurde. */
  sourceAccountIds?: string[];
  /** Menschlich lesbare Quelle: „Seite 25 · Sonstige Vermögensgegenstände · Summe“. */
  sourceLabel: string;
  comment: CheckComment;
  assignment: "rule" | "jev" | "model";
  confidenceBp: number | null;
  sourceKey: string;
  /** Posten oder Tabellenzeile des Gegenstands, für den Titel einer Feststellung. */
  subjectLabel?: string | null;
};

export const commentLimit = 160;
export const findingTitleLimit = 60;
