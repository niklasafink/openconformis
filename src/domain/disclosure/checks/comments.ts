import { abs, formatMicro } from "../arithmetic";
import type { FigureUnit } from "../figures";

import { commentLimit, findingTitleLimit, type CheckComment, type CommentCode } from "./types";

/**
 * Kommentare und Titel des Plausichecks entstehen ausschließlich aus diesen Vorlagen:
 * kein Modelltext, keine Formulierungsvorschläge, höchstens 160 Zeichen. Parameter sind
 * bereits formatierte Beträge und kurze Labels aus dem Bericht.
 */

type Locale = "de" | "en";

const templates: Record<CommentCode, Record<Locale, string>> = {
  sum_matches: {
    de: "Summe der {count} Positionen stimmt{rounded}.",
    en: "The sum of {count} items matches{rounded}.",
  },
  sum_differs: {
    de: "Summe weicht um {difference} ab: Positionen ergeben {expected}.",
    en: "Sum differs by {difference}: the items add up to {expected}.",
  },
  sum_ambiguous: {
    de: "Summe nicht eindeutig: die Positionen der Summe sind nicht sicher bestimmbar.",
    en: "Sum not conclusive: the items of the total cannot be determined reliably.",
  },
  balance_matches: {
    de: "Summe der Aktiva gleich Summe der Passiva{rounded}.",
    en: "Total assets equal total equity and liabilities{rounded}.",
  },
  balance_differs: {
    de: "Aktiva und Passiva weichen um {difference} ab.",
    en: "Assets and liabilities differ by {difference}.",
  },
  horizontal_matches: {
    de: "Gesamtspalte gleich Summe der {count} Spalten{rounded}.",
    en: "The total column equals the sum of {count} columns{rounded}.",
  },
  horizontal_differs: {
    de: "Gesamt weicht um {difference} ab: die {count} Spalten ergeben {expected}.",
    en: "Total differs by {difference}: the {count} columns add up to {expected}.",
  },
  horizontal_incomplete: {
    de: "Zeile unvollständig lesbar, Gesamt nicht nachrechenbar.",
    en: "Row not fully readable, the total cannot be recomputed.",
  },
  change_matches: {
    de: "Veränderung gleich Berichtsjahr minus Vorjahr{rounded}.",
    en: "Change equals current minus prior year{rounded}.",
  },
  change_differs: {
    de: "Veränderung weicht um {difference} ab: gerechnet {expected}.",
    en: "Change differs by {difference}: computed {expected}.",
  },
  arithmetic_matches: {
    de: "Rechnung im Satz stimmt{rounded}.",
    en: "The arithmetic in the sentence matches{rounded}.",
  },
  arithmetic_differs: {
    de: "Rechnung im Satz weicht um {difference} ab: gerechnet {expected}.",
    en: "The arithmetic in the sentence differs by {difference}: computed {expected}.",
  },
  direction_matches: {
    de: "„{word}“ passt zu {from} → {to}.",
    en: "“{word}” fits {from} → {to}.",
  },
  direction_contradicts: {
    de: "Text sagt „{word}“, Zahlen gehen von {from} auf {to}.",
    en: "The text says “{word}”, the figures go from {from} to {to}.",
  },
  direction_unclear: {
    de: "„{word}“ nicht prüfbar: Veränderung liegt innerhalb der Rundung.",
    en: "“{word}” not verifiable: the change is within rounding.",
  },
  reference_matches: {
    de: "Stimmt mit {source} überein{rounded}.",
    en: "Agrees with {source}{rounded}.",
  },
  reference_differs: {
    de: "Weicht um {difference} von {source} ({expected}) ab.",
    en: "Differs by {difference} from {source} ({expected}).",
  },
  reference_sign: {
    de: "Vorzeichen widerspricht {source} ({expected}).",
    en: "Sign contradicts {source} ({expected}).",
  },
  reference_candidates: {
    de: "Mehrere Kandidaten für „{label}“ mit verschiedenen Werten; Zuordnung unsicher.",
    en: "Several candidates for “{label}” with different values; assignment uncertain.",
  },
  reference_structure: {
    de: "Abweichende Gliederung: {source} zeigt {expected}; Vergleich nicht eindeutig.",
    en: "Different structure: {source} shows {expected}; comparison not conclusive.",
  },
  prior_matches: {
    de: "Vorjahr stimmt mit {source} überein{rounded}.",
    en: "Prior year agrees with {source}{rounded}.",
  },
  prior_differs: {
    de: "Vorjahr weicht um {difference} von {source} ({expected}) ab.",
    en: "Prior year differs by {difference} from {source} ({expected}).",
  },
  prior_ambiguous: {
    de: "„(Vorjahr …)“ nach „um“ ist mehrdeutig: Bestand oder Veränderung.",
    en: "“(prior year …)” after a change is ambiguous: balance or change.",
  },
  derived_matches: {
    de: "{formula} ergibt {expected}{rounded}.",
    en: "{formula} gives {expected}{rounded}.",
  },
  derived_differs: {
    de: "{formula} ergibt {expected}, Abweichung {difference}.",
    en: "{formula} gives {expected}, difference {difference}.",
  },
  ratio_matches: {
    de: "{formula} = {expected}{rounded}.",
    en: "{formula} = {expected}{rounded}.",
  },
  ratio_differs: {
    de: "{formula} = {expected}, Abweichung {difference}.",
    en: "{formula} = {expected}, difference {difference}.",
  },
  model_unsure: {
    de: "Zuordnung zu „{label}“ unsicher.",
    en: "Assignment to “{label}” uncertain.",
  },
};

const roundedSuffix: Record<Locale, string> = { de: ", gerundet", en: ", rounded" };

function clip(text: string, limit: number) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function renderComment(comment: CheckComment, locale: Locale = "de") {
  const template = templates[comment.code]?.[locale] ?? templates[comment.code]?.de ?? "";
  const text = template.replace(/\{(\w+)\}/gu, (_, name: string) => {
    if (name === "rounded") return comment.params.rounded === "1" ? roundedSuffix[locale] : "";
    return comment.params[name] ?? "";
  });
  return clip(text, commentLimit);
}

const titles: Partial<Record<CommentCode, Record<Locale, string>>> = {
  sum_differs: { de: "Summe weicht ab", en: "Sum differs" },
  balance_differs: { de: "Aktiva ≠ Passiva", en: "Assets ≠ liabilities" },
  horizontal_differs: { de: "Gesamtspalte weicht ab", en: "Total column differs" },
  change_differs: { de: "Veränderung weicht ab", en: "Change differs" },
  arithmetic_differs: { de: "Rechnung im Satz weicht ab", en: "Sentence arithmetic differs" },
  direction_contradicts: {
    de: "Richtung widerspricht Zahlen",
    en: "Direction contradicts figures",
  },
  reference_differs: { de: "Abweichung zu anderer Angabe", en: "Differs from other figure" },
  reference_sign: { de: "Vorzeichen widerspricht", en: "Sign contradicts" },
  reference_candidates: { de: "Mehrere Kandidaten", en: "Several candidates" },
  reference_structure: { de: "Abweichende Gliederung", en: "Different structure" },
  prior_differs: { de: "Vorjahr weicht ab", en: "Prior year differs" },
  prior_ambiguous: { de: "Vorjahresangabe mehrdeutig", en: "Prior-year figure ambiguous" },
  derived_differs: { de: "Abgeleiteter Posten weicht ab", en: "Derived item differs" },
  ratio_differs: { de: "Quote weicht ab", en: "Ratio differs" },
  sum_ambiguous: { de: "Summe nicht eindeutig", en: "Sum not conclusive" },
  model_unsure: { de: "Zuordnung unsicher", en: "Assignment uncertain" },
};

/** Titel einer Feststellung: Art der Abweichung und der Posten, höchstens 60 Zeichen. */
export function renderFindingTitle(
  comment: CheckComment,
  subject: string | null,
  locale: Locale = "de",
) {
  const base = titles[comment.code]?.[locale] ?? titles.reference_differs![locale];
  return clip(subject ? `${base}: ${subject}` : base, findingTitleLimit);
}

/** Einheitenzusatz so, wie der Bericht die Zahl zeigt. */
export function unitSuffix(unit: FigureUnit, scale: number) {
  if (unit === "percent") return " %";
  if (unit !== "EUR") return "";
  if (scale === 1_000) return " TEUR";
  if (scale === 1_000_000) return " Mio. EUR";
  return " EUR";
}

/** Ein Betrag in der Darstellung einer Bezugszahl (Skala und Nachkommastellen). */
export function formatAmount(
  micro: bigint,
  reference: { unit: FigureUnit; scale: number; decimals: number },
) {
  const scale = BigInt(reference.unit === "EUR" ? reference.scale : 1);
  const decimals = Math.min(6, reference.decimals);
  // In der Skala der Bezugszahl: Mikroeinheiten der Grundeinheit ÷ Skala.
  return formatMicro(micro / scale, decimals, unitSuffix(reference.unit, reference.scale));
}

/** Differenz immer als Betrag ohne Vorzeichen, in der feineren Darstellung. */
export function formatDifference(
  difference: bigint,
  reference: { unit: FigureUnit; scale: number; decimals: number },
) {
  return formatAmount(abs(difference), reference);
}
