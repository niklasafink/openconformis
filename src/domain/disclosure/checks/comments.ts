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
  evidence_matches: {
    de: "Stimmt mit {source} überein{rounded}.",
    en: "Agrees with {source}{rounded}.",
  },
  evidence_differs: {
    de: "Weicht um {difference} von {source} ({expected}) ab.",
    en: "Differs by {difference} from {source} ({expected}).",
  },
  year_suspect: {
    de: "„{year}“ steht, wo der Satz das Berichtsjahr {reportYear} beschreibt.",
    en: "“{year}” appears where the sentence describes the report year {reportYear}.",
  },
  year_not_rolled: {
    de: "Absatz wie im Vorjahresbericht{source}; „{year}“ ist unverändert geblieben.",
    en: "Paragraph as in the prior-year report{source}; “{year}” was left unchanged.",
  },
  prior_report_matches: {
    de: "Vorjahr stimmt mit dem Vorjahresbericht{source} überein{rounded}.",
    en: "Prior year agrees with the prior-year report{source}{rounded}.",
  },
  prior_report_differs: {
    de: "Vorjahr weicht um {difference} vom Vorjahresbericht{source} ab: dort {expected}.",
    en: "Prior year differs by {difference} from the prior-year report{source}: it shows {expected}.",
  },
};

/**
 * Warum eine Prüfung so ausgeht, in einem Satz ohne Beträge: die Beträge zeigt die
 * Berechnung daneben. Kurz genug für die erste Zeile eines Befunds.
 */
const reasons: Record<CommentCode, Record<Locale, string>> = {
  sum_matches: { de: "Summe der Tabellenzeile stimmt.", en: "The table total adds up." },
  sum_differs: {
    de: "Summe aus der Tabelle stimmt nicht.",
    en: "The table total does not add up.",
  },
  sum_ambiguous: {
    de: "Die Posten der Summe sind nicht sicher bestimmbar.",
    en: "The items of the total cannot be determined reliably.",
  },
  balance_matches: {
    de: "Aktiva und Passiva sind gleich.",
    en: "Assets and liabilities are equal.",
  },
  balance_differs: {
    de: "Aktiva und Passiva sind nicht gleich.",
    en: "Assets and liabilities are not equal.",
  },
  horizontal_matches: {
    de: "Gesamtspalte stimmt mit den Spalten überein.",
    en: "The total column matches the columns.",
  },
  horizontal_differs: {
    de: "Gesamtspalte stimmt nicht mit den Spalten überein.",
    en: "The total column does not match the columns.",
  },
  horizontal_incomplete: { de: "Zeile nicht vollständig lesbar.", en: "Row not fully readable." },
  change_matches: {
    de: "Veränderung entspricht Berichtsjahr minus Vorjahr.",
    en: "Change equals current year minus prior year.",
  },
  change_differs: {
    de: "Veränderung entspricht nicht Berichtsjahr minus Vorjahr.",
    en: "Change does not equal current year minus prior year.",
  },
  arithmetic_matches: {
    de: "Rechnung im Satz geht auf.",
    en: "The arithmetic in the sentence adds up.",
  },
  arithmetic_differs: {
    de: "Rechnung im Satz geht nicht auf.",
    en: "The arithmetic in the sentence does not add up.",
  },
  direction_matches: {
    de: "Richtungswort passt zu den Zahlen.",
    en: "The direction word fits the figures.",
  },
  direction_contradicts: {
    de: "Richtungswort widerspricht den Zahlen.",
    en: "The direction word contradicts the figures.",
  },
  direction_unclear: {
    de: "Veränderung liegt innerhalb der Rundung.",
    en: "The change is within rounding.",
  },
  reference_matches: {
    de: "Zahl stimmt mit der anderen Stelle im Bericht überein.",
    en: "Figure agrees with the other place in the report.",
  },
  reference_differs: {
    de: "Zahl steht an anderer Stelle im Bericht und ist dort anders.",
    en: "The figure appears elsewhere in the report with a different value.",
  },
  reference_sign: {
    de: "Zahl steht an anderer Stelle im Bericht mit anderem Vorzeichen.",
    en: "The figure appears elsewhere in the report with the opposite sign.",
  },
  reference_candidates: {
    de: "Mehrere Stellen im Bericht kommen infrage, mit verschiedenen Werten.",
    en: "Several places in the report qualify, with different values.",
  },
  reference_structure: {
    de: "Andere Gliederung an der anderen Stelle; Vergleich nicht eindeutig.",
    en: "Different structure at the other place; comparison not conclusive.",
  },
  prior_matches: {
    de: "Vorjahreswert stimmt mit der anderen Stelle im Bericht überein.",
    en: "Prior-year figure agrees with the other place in the report.",
  },
  prior_differs: {
    de: "Vorjahreswert steht an anderer Stelle im Bericht und ist dort anders.",
    en: "The prior-year figure appears elsewhere in the report with a different value.",
  },
  prior_ambiguous: {
    de: "Vorjahresangabe nach „um“ ist mehrdeutig.",
    en: "Prior-year figure after a change is ambiguous.",
  },
  derived_matches: { de: "Formel ergibt den Wert.", en: "The formula gives this value." },
  derived_differs: {
    de: "Formel ergibt einen anderen Wert.",
    en: "The formula gives a different value.",
  },
  ratio_matches: {
    de: "Quote ergibt sich aus den Zahlen.",
    en: "The ratio follows from the figures.",
  },
  ratio_differs: {
    de: "Quote ergibt sich nicht aus den Zahlen.",
    en: "The ratio does not follow from the figures.",
  },
  model_unsure: {
    de: "Zuordnung durch das Modell unsicher.",
    en: "Assignment by the model uncertain.",
  },
  evidence_matches: {
    de: "Zahl stimmt mit der SuSa überein.",
    en: "Figure agrees with the trial balance.",
  },
  evidence_differs: {
    de: "Zahl weicht von der SuSa ab.",
    en: "Figure differs from the trial balance.",
  },
  year_suspect: {
    de: "Jahreszahl passt nicht zum Berichtsjahr.",
    en: "Year does not fit the report year.",
  },
  year_not_rolled: {
    de: "Jahreszahl wurde nicht fortgeschrieben.",
    en: "Year was not rolled forward.",
  },
  prior_report_matches: {
    de: "Vorjahreswert stimmt mit dem Vorjahresbericht überein.",
    en: "Prior-year figure agrees with the prior-year report.",
  },
  prior_report_differs: {
    de: "Vorjahreswert weicht vom Vorjahresbericht ab.",
    en: "Prior-year figure differs from the prior-year report.",
  },
};

/** Die kurze Begründung eines Befunds, ohne Beträge. */
export function renderReason(code: CommentCode, locale: Locale = "de") {
  return reasons[code]?.[locale] ?? reasons[code]?.de ?? "";
}

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
  evidence_differs: { de: "Abweichung zur SuSa", en: "Differs from trial balance" },
  year_suspect: { de: "Jahr möglicherweise nicht fortgeschrieben", en: "Year possibly not rolled" },
  year_not_rolled: { de: "Jahr nicht fortgeschrieben", en: "Year not rolled forward" },
  prior_report_differs: {
    de: "Abweichung zum Vorjahresbericht",
    en: "Differs from prior-year report",
  },
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
