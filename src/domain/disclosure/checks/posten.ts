/**
 * Posten des Plausichecks: die Bilanz-, GuV- und Kennzahlenbegriffe, über die eine Zahl
 * im Text einer Tabellenzeile zugeordnet wird. Der Katalog ist Code, kein Modellwissen;
 * jede Zuordnung wird nachgerechnet. `row` erkennt ein Zeilenlabel, `text` eine Nennung
 * im Fließtext. Aufwandsposten werden je nach Darstellung mit oder ohne Minus gezeigt
 * und deshalb auch über den Betrag verglichen.
 */

export type PostenKind = "balance" | "income" | "expense" | "result" | "ratio";

export type Posten = Readonly<{
  key: string;
  label: string;
  kind: PostenKind;
  row: RegExp;
  text: RegExp;
  /** Ein Wort im Text, das ein positives Ergebnis als Verlust ausweist („Jahresfehlbetrag“). */
  negativeWord?: RegExp;
}>;

const w = "(?<![\\p{L}])";
const e = "(?![\\p{L}])";

function words(pattern: string) {
  return new RegExp(`${w}(?:${pattern})${e}`, "iu");
}

export const postenCatalogue: readonly Posten[] = [
  {
    key: "bilanzsumme",
    label: "Bilanzsumme",
    kind: "balance",
    row: /^(?:Summe der (?:Aktiva|Passiva)|Bilanzsumme|Summe Aktiva|Summe Passiva)$/iu,
    text: words("Bilanzsumme|Gesamtkapitals?"),
  },
  {
    key: "anlagevermoegen",
    label: "Anlagevermögen",
    kind: "balance",
    row: /^Anlagevermögen(?: insgesamt)?$/iu,
    text: words("Anlagevermögens?"),
  },
  {
    key: "umlaufvermoegen",
    label: "Umlaufvermögen",
    kind: "balance",
    row: /^Umlaufvermögen(?: insgesamt)?$/iu,
    text: words("Umlaufvermögens?"),
  },
  {
    key: "sachanlagen",
    label: "Sachanlagen",
    kind: "balance",
    row: /^Sachanlagen$/iu,
    text: words("Sachanlagen"),
  },
  {
    key: "vorraete",
    label: "Vorräte",
    kind: "balance",
    row: /^Vorräte$/iu,
    text: words("Vorräte"),
  },
  {
    key: "forderungen_ll",
    label: "Forderungen aus Lieferungen und Leistungen",
    kind: "balance",
    row: /^Forderungen aus Lieferungen und Leistungen$/iu,
    text: words("Forderungen aus Lieferungen und Leistungen|Forderungen aus L\\+L"),
  },
  {
    key: "sonstige_vermoegensgegenstaende",
    label: "Sonstige Vermögensgegenstände",
    kind: "balance",
    row: /^Sonstige Vermögensgegenstände$/iu,
    text: words("sonstigen? Vermögensgegenstände"),
  },
  {
    key: "liquide_mittel",
    label: "Liquide Mittel",
    kind: "balance",
    row: /^(?:Liquide Mittel|Guthaben bei Kreditinstituten)$/iu,
    text: words("liquiden? Mittel(?:n)?"),
  },
  {
    key: "forderungen_kunden",
    label: "Forderungen an Kunden",
    kind: "balance",
    row: /^Forderungen an Kunden$/iu,
    text: words("Forderungen an Kunden"),
  },
  {
    key: "forderungen_kreditinstitute",
    label: "Forderungen an Kreditinstitute",
    kind: "balance",
    row: /^Forderungen an Kreditinstitute:?$/iu,
    text: words("Forderungen an Kreditinstitute"),
  },
  {
    key: "eigenkapital",
    label: "Eigenkapital",
    kind: "balance",
    row: /^Eigenkapital(?: insgesamt)?$/iu,
    text: words("Eigenkapitals?|Eigenkapital"),
  },
  {
    key: "pensionsrueckstellungen",
    label: "Pensionsrückstellungen",
    kind: "balance",
    row: /^(?:Pensionsrückstellungen|Rückstellungen für Pensionen(?: und ähnliche Verpflichtungen)?)$/iu,
    text: words("Pensionsrückstellungen"),
  },
  {
    key: "rueckstellungen",
    label: "Rückstellungen",
    kind: "balance",
    row: /^Rückstellungen$/iu,
    text: new RegExp(`${w}Rückstellungen(?! für)${e}`, "u"),
  },
  {
    key: "verbindlichkeiten",
    label: "Verbindlichkeiten",
    kind: "balance",
    row: /^Verbindlichkeiten$/iu,
    text: new RegExp(
      `(?<![\\p{L}]|sonstigen |Sonstigen )Verbindlichkeiten(?! (?:aus|gegenüber))${e}`,
      "u",
    ),
  },
  {
    key: "verbindlichkeiten_ll",
    label: "Verbindlichkeiten aus Lieferungen und Leistungen",
    kind: "balance",
    row: /^Verbindlichkeiten aus Lieferungen und Leistungen$/iu,
    text: words("Verbindlichkeiten aus Lieferungen und Leistungen"),
  },
  {
    key: "fremdkapital",
    label: "Fremdkapital",
    kind: "balance",
    row: /^Fremdkapital$/iu,
    text: new RegExp(`${w}Fremdkapital(?:s)?(?!quote|struktur)${e}`, "iu"),
  },
  {
    key: "eigenkapitalquote",
    label: "Eigenkapitalquote",
    kind: "ratio",
    row: /^Eigenkapitalquote$/iu,
    text: words("Eigenkapitalquote"),
  },
  {
    key: "fremdkapitalquote",
    label: "Fremdkapitalquote",
    kind: "ratio",
    row: /^Fremdkapitalquote$/iu,
    text: words("Fremdkapitalquote"),
  },
  {
    key: "umsatzerloese",
    label: "Umsatzerlöse",
    kind: "income",
    row: /^Umsatzerlöse$/iu,
    text: words("Umsatzerlöse"),
  },
  {
    key: "materialaufwand",
    label: "Materialaufwand",
    kind: "expense",
    row: /^Materialaufwand$/iu,
    text: words("Materialaufwand|Materialaufwands"),
  },
  {
    key: "personalaufwand",
    label: "Personalaufwand",
    kind: "expense",
    row: /^Personalaufwand$/iu,
    text: words("Personalaufwand|Personalaufwands|Personalaufwendungen"),
  },
  {
    key: "abschreibungen",
    label: "Abschreibungen",
    kind: "expense",
    row: /^Abschreibungen$/iu,
    text: new RegExp(`${w}Abschreibungen(?! auf)${e}`, "u"),
  },
  {
    key: "sonstige_betriebliche_aufwendungen",
    label: "Sonstige betriebliche Aufwendungen",
    kind: "expense",
    row: /^Sonstige betriebliche Aufwendungen$/iu,
    text: words("sonstigen? betrieblichen? Aufwendungen|sonstige betriebliche Aufwand"),
  },
  {
    key: "sonstige_betriebliche_ertraege",
    label: "Sonstige betriebliche Erträge",
    kind: "income",
    row: /^Sonstige betriebliche Erträge$/iu,
    text: words("sonstigen? betrieblichen? Erträge"),
  },
  {
    key: "betriebsergebnis",
    label: "Betriebsergebnis",
    kind: "result",
    row: /^Betriebsergebnis$/iu,
    text: words("Betriebsergebnis|Betriebsergebnisses"),
  },
  {
    key: "zinsergebnis",
    label: "Zinsergebnis",
    kind: "result",
    row: /^Zinsergebnis$/iu,
    text: words("Zinsergebnis|Zinsergebnisses"),
  },
  {
    key: "steuern_einkommen",
    label: "Steuern vom Einkommen und vom Ertrag",
    kind: "expense",
    row: /^(?:Steuern vom Einkommen und (?:vom )?Ertrag|Steuererstattungen \(i\. ?Vj\. Steuern\) vom Einkommen und vom Ertrag)$/iu,
    // „Ergebnis vor Steuern“, „Verbindlichkeiten aus Steuern“ und „Sonstige Steuern“
    // meinen andere Posten.
    text: new RegExp(
      `${w}(?:Steuern vom Einkommen und vom Ertrag|Ertragsteuern)${e}|(?<!vor |aus |[Ss]onstige |[Ss]onstigen |[\\p{L}])Steuern${e}`,
      "u",
    ),
  },
  {
    key: "jahresergebnis",
    label: "Jahresergebnis",
    kind: "result",
    row: /^(?:Jahresüberschuss|Jahresergebnis|Jahresfehlbetrag)$/iu,
    text: words(
      "Jahresüberschuss|Jahresüberschusses|Jahresfehlbetrag|Jahresfehlbetrags|Jahresergebnis|Jahresergebnisses|Fehlbetrag",
    ),
    negativeWord: /Fehlbetrag/iu,
  },
  {
    key: "zinsertraege",
    label: "Zinsen und ähnliche Erträge",
    kind: "income",
    row: /^Zinsen und ähnliche Erträge$/iu,
    text: words("Zinserträge|Zinsen und ähnliche Erträge"),
  },
  {
    key: "zinsaufwendungen",
    label: "Zinsen und ähnliche Aufwendungen",
    kind: "expense",
    row: /^Zinsen und ähnliche Aufwendungen$/iu,
    text: words("Zinsaufwendungen|Zinsen und ähnliche Aufwendungen"),
  },
  {
    key: "nettozinsertrag",
    label: "Nettozinsertrag",
    kind: "result",
    row: /^Nettozinsertrag$/iu,
    text: words("Nettozinsertrag|Nettozinsertrags"),
  },
  {
    key: "provisionsertraege",
    label: "Provisionserträge",
    kind: "income",
    row: /^Provisionserträge$/iu,
    text: words("Provisionserträge"),
  },
  {
    key: "provisionsaufwendungen",
    label: "Provisionsaufwendungen",
    kind: "expense",
    row: /^Provisionsaufwendungen$/iu,
    text: words("Provisionsaufwendungen"),
  },
  {
    key: "provisionsergebnis",
    label: "Provisionsergebnis",
    kind: "result",
    row: /^Provisionsergebnis$/iu,
    text: words("Provisionsergebnis|Provisionsergebnisses"),
  },
  {
    key: "allgemeine_verwaltungsaufwendungen",
    label: "Allgemeine Verwaltungsaufwendungen",
    kind: "expense",
    row: /^Allgemeine Verwaltungsaufwendungen$/iu,
    text: words("allgemeinen? Verwaltungs(?:kosten|aufwendungen)|Verwaltungsaufwand"),
  },
  {
    key: "sachaufwand",
    label: "Sonstige Verwaltungsaufwendungen (Sachaufwand)",
    kind: "expense",
    row: /^sonstige Verwaltungsaufwendungen(?: \(Sachaufwand\))?$/iu,
    text: words("sonstigen? Verwaltungsaufwendungen|Sachaufwand|Verwaltungsaufwand"),
  },
  {
    key: "betriebsaufwendungen",
    label: "Betriebsaufwendungen",
    kind: "expense",
    row: /^Betriebsaufwendungen$/iu,
    text: words("Betriebsaufwendungen|Betriebsaufwands"),
  },
  {
    key: "betriebsertraege",
    label: "Betriebserträge",
    kind: "income",
    row: /^Betriebserträge$/iu,
    text: words("Betriebserträge"),
  },
  {
    key: "bilanzverlust",
    label: "Bilanzverlust",
    kind: "result",
    row: /^(?:Bilanzverlust|Bilanzgewinn|Bilanzverlust \(i\. ?Vj\. Bilanzgewinn\)|Bilanzgewinn\/-verlust)$/iu,
    text: words("Bilanzverlust|Bilanzgewinn"),
    negativeWord: /Bilanzverlust/iu,
  },
];

export const postenByKey = new Map(postenCatalogue.map((posten) => [posten.key, posten]));

/** Gliederungszeichen, „insgesamt“ und Klammerzusätze weg; so vergleichen sich Labels. */
export function normalizeLabel(label: string) {
  return label
    .replace(/^(?:[A-H]\.|[IVX]{1,4}\.|\d{1,2}[a-z]?\.|[a-z]{1,2}\)|\([a-z]\)|-)\s*/u, "")
    .replace(/:\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function postenOfRowLabel(label: string | null) {
  if (!label) return null;
  const normalized = normalizeLabel(label);
  return postenCatalogue.find((posten) => posten.row.test(normalized)) ?? null;
}

export type PostenMention = { posten: Posten; start: number; end: number };

/**
 * Alle Nennungen von Posten in einem Textabschnitt; überlappende Treffer behalten den
 * längeren („Pensionsrückstellungen“ vor „Rückstellungen“).
 */
export function findPostenMentions(text: string): PostenMention[] {
  const found: PostenMention[] = [];
  for (const posten of postenCatalogue) {
    const pattern = new RegExp(posten.text.source, `${posten.text.flags.replace("g", "")}g`);
    for (const match of text.matchAll(pattern)) {
      found.push({ posten, start: match.index, end: match.index + match[0].length });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: PostenMention[] = [];
  for (const mention of found) {
    const overlapping = kept.find(
      (other) => mention.start < other.end && other.start < mention.end,
    );
    if (!overlapping) {
      kept.push(mention);
      continue;
    }
    // Gleicher Bereich, mehrere Posten („Verwaltungsaufwand“): alle behalten.
    if (overlapping.start === mention.start && overlapping.end === mention.end) {
      kept.push(mention);
    }
  }
  return kept;
}
