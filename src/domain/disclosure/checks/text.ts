import { abs, compareWithTolerance, directionOf, ratioPercentMicro } from "../arithmetic";
import type { PeriodHint } from "../figures";

import { formatAmount, formatDifference } from "./comments";
import type { Resolved, Resolver } from "./facts";
import { findPostenMentions, postenByKey, type Posten, type PostenMention } from "./posten";
import type {
  CheckDraft,
  EngineBlock,
  EngineDocument,
  EngineFigure,
  EngineStatement,
} from "./types";

/**
 * Prüfungen im Fließtext: Zuordnung einer Zahl zu einem Posten über feste Satzmuster,
 * Satzarithmetik („von A um B auf C“), Richtungswörter gegen das Vorzeichen der
 * Veränderung und Querverweise auf die Tabellen. Was die Regeln nicht eindeutig
 * zuordnen, bleibt für die Einordnung durch das Modell (`PendingMention`).
 */

export type PendingMention = {
  figureId: string;
  blockId: string;
  /** Der Satz um die Zahl; Grundlage der Einordnung. */
  sentence: string;
  /** Lage der Zahl im Satz. */
  start: number;
  end: number;
  candidates: Array<{ key: string; label: string }>;
};

type Span = { start: number; end: number };

const monthIndex: Record<string, number> = {
  januar: 1,
  jänner: 1,
  februar: 2,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

const abbreviations =
  /\b(?:Mio|Mrd|Tsd|bzw|ca|vgl|gem|lt|Nr|Abs|S|Tz|Dr|Prof|rd|inkl|ggf|sog|u\.a|z\.\s?B|d\.\s?h|i\.\s?Vj|Vj|i\.\s?V|Anm|Ziff|Art|evtl|zzgl|abzgl)$/u;
const monthAfter =
  /^\s+(?:Januar|Jänner|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/u;

/** Sätze eines Blocks; Punkte in Abkürzungen und Zahlen beenden keinen Satz. */
export function sentencesOf(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?](?=\s+[\p{Lu}\d„"(])/gu)) {
    const end = match.index + 1;
    const before = text.slice(Math.max(start, match.index - 12), match.index);
    if (abbreviations.test(before)) continue;
    // „31. Dezember“, „1. Januar“: ein Ordinal vor einem Monat beendet keinen Satz.
    if (/(?:^|\s)\d{1,2}$/u.test(before) && monthAfter.test(text.slice(end, end + 14))) continue;
    if (/(?:^|\s)\d{1,2}$/u.test(before) && /^\s+\d/u.test(text.slice(end, end + 3))) continue;
    spans.push({ start, end });
    start = end;
    while (start < text.length && /\s/u.test(text[start]!)) start += 1;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}

/** Teilsätze: „;“ außerhalb von Klammern und „ sowie “ trennen Aussagen. */
export function clausesOf(text: string, sentence: Span): Span[] {
  const spans: Span[] = [];
  let start = sentence.start;
  let depth = 0;
  for (let index = sentence.start; index < sentence.end; index += 1) {
    const char = text[index]!;
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === ";") {
      spans.push({ start, end: index });
      start = index + 1;
    } else if (depth === 0 && text.startsWith(" sowie ", index)) {
      spans.push({ start, end: index });
      start = index + 1;
    }
  }
  spans.push({ start, end: sentence.end });
  return spans.filter((span) => span.end > span.start);
}

const unitTokens =
  /(?:TEUR|T\s?€|Tsd\.\s?(?:€|EUR)|Mio\.\s?(?:EUR|€)?|Millionen|Mrd\.|EUR|€|%-Punkte|Prozentpunkte|Prozent|%)/gu;

function tokens(text: string) {
  return text
    .replace(unitTokens, " ")
    .replace(/[,]/gu, " ")
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

function gapText(text: string, from: number, to: number, skip: readonly EngineFigure[] = []) {
  let gap = text.slice(from, to);
  for (const figure of skip) {
    if (figure.start >= from && figure.end <= to)
      gap = gap.replace(text.slice(figure.start, figure.end), " ");
  }
  return tokens(gap.replace(/\bbzw\.\s*/gu, " ").replace(/[()]/gu, " ")).join(" ");
}

function lastWord(text: string, clauseStart: number, position: number) {
  return tokens(text.slice(clauseStart, position)).at(-1) ?? "";
}

const causal = /\b(?:aufgrund|wegen|infolge|durch|dank|trotz)\b[^,;]*$/iu;

const levelConnectors = new Set([
  "von",
  "mit",
  "in",
  "höhe",
  "auf",
  "beträgt",
  "betrug",
  "betragen",
  "betrugen",
  "belief",
  "beliefen",
  "beläuft",
  "belaufen",
  "sich",
  "liegen",
  "liegt",
  "lag",
  "lagen",
  "ist",
  "sind",
  "war",
  "waren",
  "wurde",
  "wurden",
  "der",
  "die",
  "das",
  "des",
  "dem",
  "den",
  "ein",
  "eine",
  "einem",
  "einen",
  "eines",
  "damit",
  "insgesamt",
  "rund",
  "ca.",
  "knapp",
  "nun",
  "zum",
  "zur",
  "bilanzstichtag",
  "stichtag",
  "jetzt",
  "noch",
  "nur",
  "im",
  "vorjahr",
  "vorjahr:",
  "vj:",
  "vj.",
  "i.vj.",
  "(",
  ")",
  ":",
  "verbleibenden",
  "verbleibende",
  "restliches",
  "restlichen",
  "aufgelaufene",
  "per",
  "summe",
  "gesamthöhe",
  "einer",
  "neben",
]);
const shareConnectors = new Set([...levelConnectors, "anteil", "anteilig", "quote"]);
const afterConnectors = new Set([
  "auf",
  "den",
  "die",
  "das",
  "der",
  "dem",
  "des",
  "entfallen",
  "entfielen",
  "für",
]);

function proximate(text: string, from: number, to: number, percent: boolean) {
  const between = text
    .slice(from, to)
    .replace(/\d{1,2}\.\s?(?:Dezember|Juni|\d{1,2}\.)\s?\d{4}/gu, " ");
  const allowed = percent ? shareConnectors : levelConnectors;
  const words = tokens(between);
  return words.length <= 6 && words.every((word) => allowed.has(word) || /^\d/u.test(word));
}

type Role = "A" | "B" | "C" | "level";

type Group = {
  A?: EngineFigure;
  B?: EngineFigure;
  C?: EngineFigure;
  posten: Posten | null;
  mention: PostenMention | null;
  /** „um B (Vorjahr A)“: die Klammer kann Bestand oder Veränderung sein. */
  ambiguousPrior?: EngineFigure;
  /** „bzw. -67,6 %“ nach der Veränderung. */
  percentChange?: EngineFigure;
  /** „C (Vorjahr: A)“ ohne Satzmuster: nur für Richtungswörter. */
  levelPair?: boolean;
};

type ClauseContext = {
  block: EngineBlock;
  text: string;
  clause: Span;
  sentence: Span;
  mentions: PostenMention[];
  figures: EngineFigure[];
  statements: EngineStatement[];
  otherPeriod: boolean;
};

function mentionBefore(context: ClauseContext, position: number) {
  const candidates = context.mentions
    .filter((mention) => mention.end <= position && mention.start >= context.clause.start)
    .reverse();
  for (const mention of candidates) {
    const lead = context.text.slice(context.clause.start, mention.start);
    if (causal.test(lead)) continue;
    return mention;
  }
  return null;
}

function mentionsAt(context: ClauseContext, mention: PostenMention) {
  return context.mentions.filter(
    (entry) => entry.start === mention.start && entry.end === mention.end,
  );
}

const planning =
  /\b(?:Planung|geplant|plant|planen|erwartet|erwarten|Prognose|prognostiziert|rechnet|gerechnet|Budget|vorläufigen)\b/iu;

function hasOtherPeriod(text: string, reportYear: number | null) {
  if (planning.test(text)) return true;
  if (/\b(?:Halbjahr|Quartal|30\.\s?(?:Juni|06\.))/iu.test(text)) return true;
  if (!reportYear) return false;
  for (const match of text.matchAll(/\b((?:19|20)\d{2})\b/gu)) {
    const year = Number(match[1]);
    if (year !== reportYear && year !== reportYear - 1) return true;
  }
  return false;
}

/** Stichtag außerhalb des Jahresabschlusses („per 30. Juni 2022“), als Schlüssel. */
function dateKeyOf(text: string, reportYear: number | null) {
  const match =
    /(?:per|zum|am|Stand)\s+(\d{1,2})\.\s?(Januar|Jänner|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|\d{1,2}\.)\s?(\d{4})/iu.exec(
      text,
    );
  if (!match) return null;
  const day = Number(match[1]);
  const monthText = match[2]!.toLowerCase().replace(".", "");
  const month = monthIndex[monthText] ?? Number(monthText);
  const year = Number(match[3]);
  if (
    day === 31 &&
    month === 12 &&
    reportYear &&
    (year === reportYear || year === reportYear - 1)
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isPriorParenthesis(text: string, figure: EngineFigure) {
  if (figure.period === "prior") return true;
  const before = text.slice(Math.max(0, figure.start - 40), figure.start);
  return /Vorjahr(?:es)?(?:wert)?\s*\([^()]*$/iu.test(before);
}

function referenceOf(figure: EngineFigure) {
  return { unit: figure.unit, scale: figure.scale, decimals: figure.decimals };
}

/** Wert einer Nennung für den Vergleich: „Jahresfehlbetrag von 3.430“ ist ein Verlust. */
function signedValue(
  figure: EngineFigure,
  posten: Posten,
  context: ClauseContext,
  mention: PostenMention | null,
) {
  let micro = figure.micro!;
  if (posten.negativeWord && mention && micro > 0n) {
    const word = context.text.slice(mention.start, mention.end);
    if (posten.negativeWord.test(word)) micro = -micro;
  }
  return micro;
}

function compareReference(
  figure: EngineFigure,
  actual: bigint,
  resolved: Resolved,
  posten: Posten | null,
  kind: "cross_reference" | "prior_year",
  assignment: "rule" | "model" = "rule",
  confidenceBp: number | null = null,
): CheckDraft {
  const expense = posten?.kind === "expense";
  const signed = compareWithTolerance(
    { micro: actual, displayUnit: figure.displayUnit },
    { micro: resolved.micro, displayUnit: resolved.displayUnit },
  );
  const magnitude = compareWithTolerance(
    { micro: abs(actual), displayUnit: figure.displayUnit },
    { micro: abs(resolved.micro), displayUnit: resolved.displayUnit },
  );
  const comparison = expense && signed.status !== "match" ? magnitude : signed;
  const signOnly =
    !expense && signed.status !== "match" && magnitude.status === "match" && actual !== 0n;
  const reference = referenceOf(figure);
  let status: CheckDraft["status"] = comparison.status;
  let code: CheckDraft["comment"]["code"] =
    comparison.status === "match"
      ? kind === "prior_year"
        ? "prior_matches"
        : "reference_matches"
      : signOnly
        ? "reference_sign"
        : kind === "prior_year"
          ? "prior_differs"
          : "reference_differs";
  if (comparison.status !== "match" && !resolved.consistent) {
    status = "uncertain";
    code = "reference_candidates";
  } else if (comparison.status !== "match" && resolved.alternateOnly) {
    status = "uncertain";
    code = "reference_structure";
  } else if (comparison.status !== "match" && resolved.relabeled) {
    status = "uncertain";
    code = "reference_candidates";
  }
  if (
    assignment === "model" &&
    confidenceBp !== null &&
    confidenceBp < modelConfidenceThresholdBp &&
    status === "mismatch"
  ) {
    status = "uncertain";
    code = "model_unsure";
  }
  return {
    kind,
    status,
    subjectFigureId: figure.id,
    subjectStatementId: null,
    actual,
    expected: resolved.micro,
    tolerance: comparison.tolerance,
    rounded: comparison.rounded,
    sourceKind: resolved.formula ? "formula" : "table",
    sourceFigureIds: resolved.sources.map((source) => source.id),
    sourceBlockIds: [],
    sourceLabel: resolved.sourceLabel,
    comment: {
      code,
      params: {
        source: resolved.sourceLabel.slice(0, 70),
        expected: formatAmount(resolved.micro, reference),
        difference: formatDifference(comparison.difference, reference),
        label: resolved.label,
        rounded: comparison.rounded ? "1" : "0",
      },
    },
    assignment,
    confidenceBp,
    sourceKey: `ref:${resolved.key}:${resolved.period}`,
  };
}

export const modelConfidenceThresholdBp = 7_000;

/** Zahl im Text gegen den Tabellenwert eines Postens; Quoten über Formeln. */
export function referenceCheck(
  figure: EngineFigure,
  posten: Posten,
  period: PeriodHint,
  resolver: Resolver,
  options: {
    share: boolean;
    actual?: bigint;
    assignment?: "rule" | "model";
    confidenceBp?: number | null;
  } = { share: false },
): CheckDraft | null {
  const kind = period === "prior" ? "prior_year" : "cross_reference";
  if (figure.unit === "percent") {
    const resolved =
      posten.kind === "ratio"
        ? resolver.resolve(posten.key, period)
        : options.share
          ? resolver.shareOf(posten.key, period)
          : null;
    if (!resolved) return null;
    const draft = compareReference(
      figure,
      options.actual ?? figure.micro!,
      resolved,
      posten,
      kind,
      options.assignment,
      options.confidenceBp ?? null,
    );
    return { ...draft, kind: "ratio", comment: ratioComment(draft, resolved, figure) };
  }
  if (figure.unit !== "EUR") return null;
  const resolved = resolver.resolve(posten.key, period);
  if (!resolved) return null;
  const draft = compareReference(
    figure,
    options.actual ?? figure.micro!,
    resolved,
    posten,
    kind,
    options.assignment,
    options.confidenceBp ?? null,
  );
  return resolved.formula
    ? { ...draft, kind: "derived", comment: derivedComment(draft, resolved, figure) }
    : draft;
}

function ratioComment(
  draft: CheckDraft,
  resolved: Resolved,
  figure: EngineFigure,
): CheckDraft["comment"] {
  if (draft.status === "uncertain") return draft.comment;
  const reference = { unit: "percent" as const, scale: 1, decimals: Math.max(1, figure.decimals) };
  return {
    code: draft.status === "match" ? "ratio_matches" : "ratio_differs",
    params: {
      formula: resolved.formula ?? resolved.label,
      expected: formatAmount(resolved.micro, reference),
      difference: formatDifference((draft.actual ?? 0n) - resolved.micro, reference),
      rounded: draft.rounded ? "1" : "0",
    },
  };
}

function derivedComment(
  draft: CheckDraft,
  resolved: Resolved,
  figure: EngineFigure,
): CheckDraft["comment"] {
  if (draft.status === "uncertain") return draft.comment;
  const reference = referenceOf(figure);
  return {
    code: draft.status === "match" ? "derived_matches" : "derived_differs",
    params: {
      formula: resolved.formula ?? resolved.label,
      expected: formatAmount(resolved.micro, reference),
      difference: formatDifference((draft.actual ?? 0n) - resolved.micro, reference),
      rounded: draft.rounded ? "1" : "0",
    },
  };
}

/** Rollen der Zahlen eines Teilsatzes nach den Satzmustern. */
function groupsOf(context: ClauseContext): { groups: Group[]; roles: Map<string, Role> } {
  const roles = new Map<string, Role>();
  const groups: Group[] = [];
  const { text, clause } = context;
  for (const unit of ["EUR", "percent"] as const) {
    const sequence = context.figures.filter((figure) => figure.unit === unit);
    const skip =
      unit === "EUR" ? context.figures.filter((figure) => figure.unit === "percent") : [];
    for (let index = 0; index < sequence.length; index += 1) {
      const figure = sequence[index]!;
      if (roles.has(figure.id)) continue;
      const next = sequence[index + 1];
      const afterNext = sequence[index + 2];
      const word = lastWord(text, clause.start, figure.start);
      const gap = (a: EngineFigure, b: EngineFigure) => gapText(text, a.end, b.start, skip);
      const group: Group = { posten: null, mention: null };
      if (word === "von" && next && gap(figure, next) === "um") {
        group.A = figure;
        group.B = next;
        if (afterNext && gap(next, afterNext) === "auf") group.C = afterNext;
      } else if (word === "von" && next && gap(figure, next) === "auf") {
        group.A = figure;
        group.C = next;
      } else if (word === "um") {
        group.B = figure;
        if (next && gap(figure, next) === "auf") group.C = next;
        else if (
          next &&
          (next.parenthesized || next.period === "prior") &&
          /^(?:vorjahr|vj\.?|i\.vj\.?)$/u.test(gap(figure, next).replace(/:$/u, ""))
        ) {
          group.ambiguousPrior = next;
        }
      } else if (word === "auf") {
        group.C = figure;
        if (next && (isPriorParenthesis(text, next) || gap(figure, next) === "nach"))
          group.A = next;
      } else if (next && isPriorParenthesis(text, next) && !isPriorParenthesis(text, figure)) {
        // „C (Vorjahr: A)“: zwei Stände; eine Veränderung nur für ein Richtungswort. Die
        // Zuordnung der Stände übernimmt die Einzelzahl-Regel.
        groups.push({ C: figure, A: next, posten: null, mention: null, levelPair: true });
        index += 1;
        continue;
      } else {
        continue;
      }
      for (const member of [group.A, group.B, group.C, group.ambiguousPrior]) {
        if (member)
          roles.set(
            member.id,
            member === group.A
              ? "A"
              : member === group.B
                ? "B"
                : member === group.C
                  ? "C"
                  : "level",
          );
      }
      if (unit === "EUR" && group.B) {
        const percent = context.figures.find(
          (candidate) =>
            candidate.unit === "percent" &&
            candidate.start > group.B!.end &&
            /^\s*(?:TEUR|EUR|T€)?\s*bzw\.\s*$/u.test(text.slice(group.B!.end, candidate.start)),
        );
        if (percent) {
          group.percentChange = percent;
          roles.set(percent.id, "B");
        }
      }
      const first = group.A ?? group.B ?? group.C!;
      const mention =
        (unit === "percent" ? shareMention(context, first) : null) ??
        mentionBefore(context, first.start);
      group.mention = mention;
      group.posten = mention?.posten ?? null;
      groups.push(group);
    }
  }
  return { groups, roles };
}

/** Posten einer einzelnen Zahl: nahe davor, nahe danach oder aus der Klammer davor. */
function levelPosten(
  context: ClauseContext,
  figure: EngineFigure,
  previous: { figure: EngineFigure; mention: PostenMention | null } | null,
): PostenMention | null {
  const percent = figure.unit === "percent";
  const { text } = context;
  if (percent) {
    const shareMatch = shareMention(context, figure);
    if (shareMatch) return shareMatch;
  }
  const sentenceText = text.slice(context.sentence.start, context.sentence.end);
  // „… Rückstellungen in Höhe von TEUR 462 gebildet“: eine Bewegung, kein Bestand.
  if (movement.test(sentenceText)) return null;
  // „… gegenüber einer Gesellschafterin“, „davon …“: ein Teilbetrag.
  if (partOf.test(text.slice(figure.end, context.clause.end).slice(0, 40))) return null;
  // „… betreffen mit 46 TEUR Verbindlichkeiten aus L+L“: in Enthält-Sätzen ist ein
  // Posten nach der Zahl ein Teil, kein Bestand.
  const composition = compositionVerb.test(sentenceText);
  const inParenthesis = /\([^()]*$/u.test(text.slice(context.clause.start, figure.start));
  const before = context.mentions
    .filter((mention) => mention.end <= figure.start && mention.start >= context.clause.start)
    .at(-1);
  if (before && isAttribute(text, context.clause.start, before))
    return inheritedPrior(context, figure, previous, inParenthesis);
  if (before && /\bIn (?:den|dem|der)\s+$/u.test(text.slice(context.clause.start, before.start)))
    return null;
  if (before && proximate(text, before.end, figure.start, percent)) {
    // In einer Klammer gilt ein Posten nur, wenn er selbst in der Klammer steht.
    const parenStart = text.lastIndexOf("(", figure.start);
    if (!inParenthesis || before.start > parenStart) return before;
  }
  const after = context.mentions.find(
    (mention) => mention.start >= figure.end && mention.end <= context.clause.end,
  );
  if (
    after &&
    !composition &&
    tokens(text.slice(figure.end, after.start)).every((word) => afterConnectors.has(word))
  ) {
    return after;
  }
  return inheritedPrior(context, figure, previous, inParenthesis);
}

/** „Der Anteil des Fremdkapitals … an der Bilanzsumme … 76,0 %“. */
function shareMention(context: ClauseContext, figure: EngineFigure) {
  return (
    context.mentions.find((mention) => {
      const lead = context.text.slice(
        Math.max(context.clause.start, mention.start - 16),
        mention.start,
      );
      return /Anteil (?:des|der|am|an)\s*$/iu.test(lead) && mention.start < figure.start;
    }) ?? null
  );
}

function inheritedPrior(
  context: ClauseContext,
  figure: EngineFigure,
  previous: { figure: EngineFigure; mention: PostenMention | null } | null,
  inParenthesis: boolean,
): PostenMention | null {
  if (inParenthesis && previous && isPriorParenthesis(context.text, figure))
    return previous.mention;
  return null;
}

const movement =
  /\b(?:gebildet|zugeführt|aufgelöst|verbraucht|in Anspruch genommen|abgesetzt|beibehalten|Auflösung|Zuführung|Aufzinsung)\b/iu;
const partOf = /^[^.;]*?\b(?:gegenüber (?:einer|einem|der|dem|den)|davon|darunter)\b/iu;
const compositionVerb =
  /\b(?:enthalten|enthält|beinhalten|beinhaltet|betreffen|betrifft|umfassen|umfasst|bestehen aus|entfallen|entfällt)\b/iu;

/** „Auflösung von Rückstellungen“: der Posten ist Attribut eines anderen Substantivs. */
function isAttribute(text: string, clauseStart: number, mention: PostenMention) {
  const lead = text.slice(clauseStart, mention.start);
  return (
    /\p{Lu}\p{Ll}+\s+(?:von|aus)\s+(?:der|den|dem)?\s*$/u.test(lead) &&
    !/Anteil\s+(?:von|aus)\s+(?:der|den|dem)?\s*$/u.test(lead)
  );
}

type DateEntry = {
  key: string;
  figure: EngineFigure;
  posten: Posten;
  actual: bigint;
  label: string;
};

export type TextResult = {
  drafts: CheckDraft[];
  pending: PendingMention[];
};

export function textChecks(
  document: EngineDocument,
  resolver: Resolver,
  factLabels: ReadonlyArray<{ key: string; label: string }>,
): TextResult {
  const drafts: CheckDraft[] = [];
  const pending: PendingMention[] = [];
  const dated: DateEntry[] = [];
  const figuresByBlock = groupBy(document.figures, (figure) => figure.blockId);
  const statementsByBlock = groupBy(document.statements, (statement) => statement.blockId);

  for (const block of document.blocks) {
    if (block.table || block.technical) continue;
    const figures = (figuresByBlock.get(block.id) ?? []).filter(
      (figure) =>
        figure.micro !== null &&
        !figure.issue &&
        (figure.unit === "EUR" || figure.unit === "percent"),
    );
    const statements = statementsByBlock.get(block.id) ?? [];
    if (figures.length === 0 && statements.length === 0) continue;
    const text = block.text;
    const mentions = findPostenMentions(text);
    for (const sentence of sentencesOf(text)) {
      const sentenceText = text.slice(sentence.start, sentence.end);
      const otherPeriod = hasOtherPeriod(sentenceText, document.reportYear);
      const dateKey = dateKeyOf(sentenceText, document.reportYear);
      for (const clause of clausesOf(text, sentence)) {
        const context: ClauseContext = {
          block,
          text,
          clause,
          sentence,
          mentions: mentions.filter(
            (mention) => mention.start >= clause.start && mention.end <= clause.end,
          ),
          figures: figures.filter(
            (figure) => figure.start >= clause.start && figure.end <= clause.end,
          ),
          statements: statements.filter(
            (statement) => statement.start >= clause.start && statement.end <= clause.end,
          ),
          otherPeriod,
        };
        const checked = new Set<string>();
        const { groups, roles } = groupsOf(context);

        for (const group of groups) {
          if (group.levelPair) continue;
          if (otherPeriod && dateKey && group.C && group.posten && !group.B) {
            dated.push({
              key: `${group.posten.key}:${dateKey}`,
              figure: group.C,
              posten: group.posten,
              actual: signedValue(group.C, group.posten, context, group.mention),
              label: group.posten.label,
            });
            checked.add(group.C.id);
            continue;
          }
          drafts.push(...groupChecks(context, group, resolver, checked));
        }

        let previous: { figure: EngineFigure; mention: PostenMention | null } | null = null;
        for (const figure of context.figures) {
          const role = roles.get(figure.id);
          const mention: PostenMention | null = role
            ? null
            : levelPosten(context, figure, previous);
          previous = { figure, mention };
          if (role || checked.has(figure.id)) continue;
          if (!mention) continue;
          const period: PeriodHint = isPriorParenthesis(text, figure) ? "prior" : "current";
          const candidates = mentionsAt(context, mention);
          if (dateKey && otherPeriod) {
            dated.push({
              key: `${mention.posten.key}:${dateKey}`,
              figure,
              posten: mention.posten,
              actual: signedValue(figure, mention.posten, context, mention),
              label: mention.posten.label,
            });
            checked.add(figure.id);
            continue;
          }
          if (otherPeriod) continue;
          const draft = candidateCheck(figure, candidates, period, resolver, context, mention);
          if (draft) {
            drafts.push(draft);
            checked.add(figure.id);
          }
        }

        for (const statement of context.statements) {
          const draft = directionCheck(context, statement, groups, resolver);
          if (draft) drafts.push(draft);
        }

        for (const figure of context.figures) {
          if (checked.has(figure.id) || roles.has(figure.id) || otherPeriod) continue;
          const candidates = lexicalCandidates(sentenceText, factLabels);
          if (candidates.length === 0) continue;
          pending.push({
            figureId: figure.id,
            blockId: block.id,
            sentence: sentenceText,
            start: figure.start - sentence.start,
            end: figure.end - sentence.start,
            candidates,
          });
        }
      }
    }
  }
  drafts.push(...datedChecks(dated));
  return { drafts, pending };
}

/** Mehrere Posten an derselben Stelle („Verwaltungsaufwand“): stimmt keiner, bleibt es orange. */
function candidateCheck(
  figure: EngineFigure,
  candidates: PostenMention[],
  period: PeriodHint,
  resolver: Resolver,
  context: ClauseContext,
  mention: PostenMention,
) {
  const share = figure.unit === "percent";
  const results = candidates
    .map((candidate) =>
      referenceCheck(figure, candidate.posten, period, resolver, {
        share,
        actual: signedValue(figure, candidate.posten, context, mention),
      }),
    )
    .filter((draft): draft is CheckDraft => draft !== null);
  if (results.length <= 1) return results[0] ?? null;
  const matching = results.filter((draft) => draft.status === "match");
  if (matching.length === 1) return matching[0]!;
  const first = results[0]!;
  return {
    ...first,
    status: "uncertain" as const,
    comment: {
      code: "reference_candidates" as const,
      params: { label: context.text.slice(mention.start, mention.end) },
    },
    sourceFigureIds: results.flatMap((draft) => draft.sourceFigureIds),
    sourceLabel: results
      .map((draft) => draft.sourceLabel)
      .join(" / ")
      .slice(0, 200),
  };
}

function groupChecks(
  context: ClauseContext,
  group: Group,
  resolver: Resolver,
  checked: Set<string>,
): CheckDraft[] {
  const drafts: CheckDraft[] = [];
  const posten = group.posten;

  if (group.ambiguousPrior && group.B) {
    for (const figure of [group.B]) {
      drafts.push({
        kind: "prior_year",
        status: "uncertain",
        subjectFigureId: figure.id,
        subjectStatementId: null,
        actual: figure.micro,
        expected: null,
        tolerance: null,
        rounded: false,
        sourceKind: "text",
        sourceFigureIds: [group.ambiguousPrior.id],
        sourceBlockIds: [context.block.id],
        sourceLabel: "Satz",
        comment: { code: "prior_ambiguous", params: {} },
        assignment: "rule",
        confidenceBp: null,
        sourceKey: `ambiguous:${group.ambiguousPrior.id}`,
      });
      checked.add(figure.id);
    }
    checked.add(group.ambiguousPrior.id);
    return drafts;
  }

  const unitPercent = (group.A ?? group.B ?? group.C)!.unit === "percent";
  const resolve = (period: PeriodHint) => {
    if (!posten || context.otherPeriod) return null;
    if (unitPercent) {
      return posten.kind === "ratio"
        ? resolver.resolve(posten.key, period)
        : resolver.shareOf(posten.key, period);
    }
    return resolver.resolve(posten.key, period);
  };
  const tableA = resolve("prior");
  const tableC = resolve("current");

  // Stände im Satz gegen die Tabellen.
  for (const [figure, period, table] of [
    [group.A, "prior", tableA],
    [group.C, "current", tableC],
  ] as const) {
    if (!figure || !posten || context.otherPeriod) continue;
    if (!table) continue;
    const draft = unitPercent
      ? referenceCheck(figure, posten, period, resolver, { share: posten.kind !== "ratio" })
      : compareReference(
          figure,
          signedValue(figure, posten, context, group.mention),
          table,
          posten,
          period === "prior" ? "prior_year" : "cross_reference",
        );
    if (draft) {
      drafts.push(
        table.formula && !unitPercent
          ? { ...draft, kind: "derived", comment: derivedComment(draft, table, figure) }
          : draft,
      );
      checked.add(figure.id);
    }
  }

  // Die Veränderung B: aus dem Satz, sonst aus den Tabellen ergänzt.
  if (group.B) {
    // Aufwand steht in manchen Tabellen mit Minus; im Satz ist er ein Betrag.
    const tableValue = (value: bigint) => (posten?.kind === "expense" ? abs(value) : value);
    const a = group.A
      ? { micro: group.A.micro!, displayUnit: group.A.displayUnit, id: group.A.id, table: false }
      : tableA && tableA.consistent
        ? {
            micro: tableValue(tableA.micro),
            displayUnit: tableA.displayUnit,
            id: null,
            table: true,
          }
        : null;
    const c = group.C
      ? { micro: group.C.micro!, displayUnit: group.C.displayUnit, id: group.C.id, table: false }
      : tableC && tableC.consistent
        ? {
            micro: tableValue(tableC.micro),
            displayUnit: tableC.displayUnit,
            id: null,
            table: true,
          }
        : null;
    if (a && c) {
      const change = c.micro - a.micro;
      const b = group.B;
      const signedB = b.micro! < 0n;
      const actual = signedB ? b.micro! : abs(b.micro!);
      const expected = signedB ? change : abs(change);
      const unit = [b.displayUnit, a.displayUnit, c.displayUnit].reduce((x, y) => (x > y ? x : y));
      const comparison = compareWithTolerance(
        { micro: actual, displayUnit: unit },
        { micro: expected, displayUnit: unit },
        a.table || c.table ? 1 : 2,
      );
      const fromTables = a.table || c.table;
      const sources = [
        ...(a.id ? [a.id] : tableA ? tableA.sources.map((source) => source.id) : []),
        ...(c.id ? [c.id] : tableC ? tableC.sources.map((source) => source.id) : []),
      ];
      const reference = referenceOf(b);
      const status =
        comparison.status === "match"
          ? "match"
          : fromTables && ((a.table && !tableA?.consistent) || (c.table && !tableC?.consistent))
            ? "uncertain"
            : comparison.status;
      drafts.push({
        kind: "sentence_arithmetic",
        status,
        subjectFigureId: b.id,
        subjectStatementId: null,
        actual,
        expected,
        tolerance: comparison.tolerance,
        rounded: comparison.rounded,
        sourceKind: fromTables ? "table" : "text",
        sourceFigureIds: sources,
        sourceBlockIds: [context.block.id],
        sourceLabel: fromTables
          ? [tableA?.sourceLabel, tableC?.sourceLabel].filter(Boolean).join(" / ").slice(0, 200)
          : "Satz",
        comment:
          comparison.status === "match"
            ? { code: "arithmetic_matches", params: { rounded: comparison.rounded ? "1" : "0" } }
            : {
                code: "arithmetic_differs",
                params: {
                  difference: formatDifference(comparison.difference, reference),
                  expected: formatAmount(expected, reference),
                },
              },
        subjectLabel: posten?.label ?? null,
        assignment: "rule",
        confidenceBp: null,
        sourceKey: `arithmetic:${a.id ?? "table"}:${c.id ?? "table"}`,
      });
      checked.add(b.id);
      if (group.percentChange && a.micro !== 0n) {
        const percent = group.percentChange;
        const ratio = ratioPercentMicro(signedB ? change : abs(change), abs(a.micro));
        if (ratio !== null) {
          const signedRatio = percent.micro! < 0n ? ratio : abs(ratio);
          const ratioComparison = compareWithTolerance(
            { micro: percent.micro!, displayUnit: percent.displayUnit },
            { micro: signedRatio, displayUnit: percent.displayUnit },
            2,
          );
          const percentReference = referenceOf(percent);
          drafts.push({
            kind: "ratio",
            status: ratioComparison.status,
            subjectFigureId: percent.id,
            subjectStatementId: null,
            actual: percent.micro,
            expected: signedRatio,
            tolerance: ratioComparison.tolerance,
            rounded: ratioComparison.rounded,
            sourceKind: fromTables ? "table" : "text",
            sourceFigureIds: sources,
            sourceBlockIds: [context.block.id],
            sourceLabel: "Veränderung / Vorjahr",
            comment: {
              code: ratioComparison.status === "match" ? "ratio_matches" : "ratio_differs",
              params: {
                formula: "Veränderung / Vorjahr",
                expected: formatAmount(signedRatio, percentReference),
                difference: formatDifference(ratioComparison.difference, percentReference),
                rounded: ratioComparison.rounded ? "1" : "0",
              },
            },
            assignment: "rule",
            confidenceBp: null,
            sourceKey: `percent-change:${b.id}`,
          });
          checked.add(percent.id);
        }
      }
    }
  }
  return drafts;
}

const nounStatements =
  /^(?:Erhöhung|Anstieg|Rückgang|Verringerung|Verminderung|Reduzierung|Zunahme|Abnahme|Zuwachs)$/iu;

function directionCheck(
  context: ClauseContext,
  statement: EngineStatement,
  groups: Group[],
  resolver: Resolver,
): CheckDraft | null {
  const { text } = context;
  const lead = text.slice(context.clause.start, statement.start);
  const noun = nounStatements.test(statement.raw);
  // Ein Richtungswort in einer Begründung („aufgrund rückläufiger …“) beschreibt eine Ursache.
  if (causal.test(lead) && !noun) return null;
  // „Erhöhung der Bilanzsumme“, „rückläufige Umsatzerlöse“: der Posten folgt dem Wort.
  const after = context.mentions.find((candidate) => candidate.start >= statement.end);
  const gapAfter = after ? text.slice(statement.end, after.start) : "";
  let mention: PostenMention | null =
    after &&
    /^\s*(?:der|des|den|die|bei der|bei den)?\s*(?:\p{L}+\s+)?$/iu.test(gapAfter) &&
    gapAfter.length <= 24
      ? after
      : null;
  // Sonst das Satzmuster, zu dem das Wort gehört: die nächste Gruppe ohne anderen Posten dazwischen.
  const sentenceGroup = mention ? null : nearestGroup(context, statement, groups);
  if (!mention && !noun)
    mention = sentenceGroup?.mention ?? mentionBefore(context, statement.start);
  let from: { micro: bigint; displayUnit: bigint; label: string; ids: string[] } | null = null;
  let to: { micro: bigint; displayUnit: bigint; label: string; ids: string[] } | null = null;
  let reference: { unit: EngineFigure["unit"]; scale: number; decimals: number } = {
    unit: "EUR",
    scale: 1_000,
    decimals: 1,
  };
  if (sentenceGroup?.A && sentenceGroup.C) {
    from = {
      micro: sentenceGroup.A.micro!,
      displayUnit: sentenceGroup.A.displayUnit,
      label: sentenceGroup.A.raw,
      ids: [sentenceGroup.A.id],
    };
    to = {
      micro: sentenceGroup.C.micro!,
      displayUnit: sentenceGroup.C.displayUnit,
      label: sentenceGroup.C.raw,
      ids: [sentenceGroup.C.id],
    };
    reference = referenceOf(sentenceGroup.C);
  } else if (mention && !context.otherPeriod) {
    const posten = mention.posten;
    const prior = resolver.resolve(posten.key, "prior");
    const current = resolver.resolve(posten.key, "current");
    if (
      !prior ||
      !current ||
      !prior.consistent ||
      !current.consistent ||
      prior.alternateOnly ||
      current.alternateOnly
    ) {
      return null;
    }
    reference =
      posten.kind === "ratio"
        ? { unit: "percent", scale: 1, decimals: 1 }
        : { unit: "EUR", scale: 1_000, decimals: 1 };
    from = {
      micro: prior.micro,
      displayUnit: prior.displayUnit,
      label: formatAmount(prior.micro, reference),
      ids: prior.sources.map((source) => source.id),
    };
    to = {
      micro: current.micro,
      displayUnit: current.displayUnit,
      label: formatAmount(current.micro, reference),
      ids: current.sources.map((source) => source.id),
    };
  } else {
    return null;
  }
  // Aufwand mit Minus und „Bilanzverlust verringert“: gemeint ist der Betrag.
  const lossWord =
    mention?.posten.negativeWord?.test(text.slice(mention.start, mention.end)) ?? false;
  if (
    (mention?.posten.kind === "expense" && from.micro < 0n && to.micro < 0n) ||
    (lossWord && from.micro <= 0n && to.micro <= 0n)
  ) {
    from = { ...from, micro: -from.micro };
    to = { ...to, micro: -to.micro };
  }
  const unit = from.displayUnit > to.displayUnit ? from.displayUnit : to.displayUnit;
  const withinRounding = abs(to.micro - from.micro) <= unit;
  const actual = directionOf(from.micro, to.micro);
  let status: CheckDraft["status"];
  let code: CheckDraft["comment"]["code"];
  let rounded = false;
  if (statement.direction === "flat") {
    const approximate = /Vorjahresniveau|Vorjahreshöhe/iu.test(statement.raw);
    const limit = approximate ? abs(from.micro) / 20n : unit;
    status = abs(to.micro - from.micro) <= (limit > unit ? limit : unit) ? "match" : "mismatch";
    rounded = status === "match" && to.micro !== from.micro;
    code = status === "match" ? "direction_matches" : "direction_contradicts";
  } else if (withinRounding) {
    status = "uncertain";
    code = "direction_unclear";
  } else {
    status = actual === statement.direction ? "match" : "mismatch";
    code = status === "match" ? "direction_matches" : "direction_contradicts";
  }
  const sourceLabel =
    sentenceGroup?.A && sentenceGroup.C
      ? "Satz"
      : `${mention?.posten.label ?? ""} Vorjahr → Berichtsjahr`;
  return {
    kind: "direction",
    status,
    subjectFigureId: null,
    subjectStatementId: statement.id,
    actual: to.micro - from.micro,
    expected: null,
    tolerance: unit,
    rounded,
    sourceKind: sourceLabel === "Satz" ? "text" : "table",
    sourceFigureIds: [...from.ids, ...to.ids],
    sourceBlockIds: [context.block.id],
    sourceLabel,
    comment: {
      code,
      params: {
        word: statement.raw,
        from: formatAmount(from.micro, reference),
        to: formatAmount(to.micro, reference),
        rounded: rounded ? "1" : "0",
      },
    },
    subjectLabel: mention?.posten.label ?? statement.raw,
    assignment: "rule",
    confidenceBp: null,
    sourceKey: `direction:${mention?.posten.key ?? "sentence"}`,
  };
}

/** Die Satzgruppe eines Richtungsworts: am nächsten, ohne fremden Posten dazwischen. */
function nearestGroup(context: ClauseContext, statement: EngineStatement, groups: Group[]) {
  let best: { group: Group; distance: number } | null = null;
  for (const group of groups) {
    const members = [group.A, group.B, group.C].filter((member): member is EngineFigure =>
      Boolean(member),
    );
    if (members.length === 0) continue;
    const start = Math.min(...members.map((member) => member.start));
    const end = Math.max(...members.map((member) => member.end));
    const [from, to] = statement.start < start ? [statement.end, start] : [end, statement.start];
    const distance = Math.max(0, to - from);
    if (distance > 90) continue;
    const foreign = context.mentions.some(
      (mention) =>
        mention.start >= from &&
        mention.end <= to &&
        (!group.mention || mention.posten.key !== group.mention.posten.key),
    );
    if (foreign) continue;
    if (!best || distance < best.distance) best = { group, distance };
  }
  return best?.group ?? null;
}

/** Dieselbe Angabe zu einem Zwischenstichtag an zwei Stellen (gbs Tz 8 und Tz 80). */
function datedChecks(entries: DateEntry[]): CheckDraft[] {
  const drafts: CheckDraft[] = [];
  const byKey = groupBy(entries, (entry) => entry.key);
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const subject of group) {
      for (const other of group) {
        if (other === subject || other.figure.unit !== subject.figure.unit) continue;
        const signed = compareWithTolerance(
          { micro: subject.actual, displayUnit: subject.figure.displayUnit },
          { micro: other.actual, displayUnit: other.figure.displayUnit },
        );
        const magnitude = compareWithTolerance(
          { micro: abs(subject.actual), displayUnit: subject.figure.displayUnit },
          { micro: abs(other.actual), displayUnit: other.figure.displayUnit },
        );
        const reference = referenceOf(subject.figure);
        const signOnly = signed.status !== "match" && magnitude.status === "match";
        drafts.push({
          kind: "cross_reference",
          status: signed.status,
          subjectFigureId: subject.figure.id,
          subjectStatementId: null,
          actual: subject.actual,
          expected: other.actual,
          tolerance: signed.tolerance,
          rounded: signed.rounded,
          sourceKind: "text",
          sourceFigureIds: [other.figure.id],
          sourceBlockIds: [other.figure.blockId],
          sourceLabel: `${subject.label}, andere Textstelle`,
          comment: {
            code:
              signed.status === "match"
                ? "reference_matches"
                : signOnly
                  ? "reference_sign"
                  : "reference_differs",
            params: {
              source: "anderer Textstelle",
              expected: formatAmount(other.actual, reference),
              difference: formatDifference(signed.difference, reference),
              rounded: signed.rounded ? "1" : "0",
            },
          },
          subjectLabel: subject.label,
          assignment: "rule",
          confidenceBp: null,
          sourceKey: `dated:${other.figure.id}`,
        });
      }
    }
  }
  return drafts;
}

/** Posten und Tabellenlabels, die im Satz vorkommen: höchstens sechs Kandidaten. */
export function lexicalCandidates(
  sentence: string,
  factLabels: ReadonlyArray<{ key: string; label: string }>,
) {
  const found = new Map<string, string>();
  for (const mention of findPostenMentions(sentence))
    found.set(mention.posten.key, mention.posten.label);
  const words = new Set(
    (sentence.toLowerCase().match(/\p{L}{6,}/gu) ?? []).filter((word) => !stopWords.has(word)),
  );
  const scored = factLabels
    .map((entry) => ({
      entry,
      score: (entry.label.toLowerCase().match(/\p{L}{6,}/gu) ?? []).filter(
        (word) => words.has(word) && !stopWords.has(word),
      ).length,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  for (const { entry } of scored) {
    if (found.size >= 6) break;
    if (!found.has(entry.key)) found.set(entry.key, entry.label);
  }
  return [...found].slice(0, 6).map(([key, label]) => ({ key, label }));
}

const stopWords = new Set([
  "sonstige",
  "sonstigen",
  "gegenüber",
  "insgesamt",
  "unternehmen",
  "verbundenen",
  "verbundene",
  "leistungen",
  "lieferungen",
  "gesellschaft",
  "vorjahr",
  "geschäftsjahr",
  "berichtsjahr",
  "betragen",
  "beträgt",
  "wesentlichen",
  "insbesondere",
  "aufgrund",
]);

function groupBy<T>(items: readonly T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(key(item)) ?? [];
    list.push(item);
    map.set(key(item), list);
  }
  return map;
}

export { postenByKey };
