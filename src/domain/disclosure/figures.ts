import { microPerUnit } from "./arithmetic";

/**
 * Zahlenerkennung des Plausichecks: deterministisch, kostenlos, versioniert. Findet in
 * einem Blocktext alle Beträge, Prozentsätze und Anzahlen mit UTF-16-Offsets und
 * normalisiert sie exakt (`bigint`). Datumsangaben, Jahreszahlen, Normzitate,
 * Randziffern und Seitenzahlen sind keine Zahlen im Sinne der Prüfung.
 */
/**
 * v3: Inhaltsverzeichnisse werden übersprungen (`table-of-contents.ts`).
 * v4: Verweisketten („§ 63 Abs 4 BWG“, „§ 56 (2) und (3)“, „AFRAC 30 Rz 12“),
 * Hausnummern und Telefonnummern sind keine Zahlen.
 */
export const figureExtractionVersion = "disclosure-figures-v4";

export type FigureUnit = "EUR" | "percent" | "count" | "unknown";
export type PeriodHint = "current" | "prior" | "other";

export type RecognizedFigure = {
  start: number;
  end: number;
  raw: string;
  /** Exakter Wert in Millionstel der Grundeinheit; `null`, wenn nicht lesbar. */
  micro: bigint | null;
  /** 1, 1.000 oder 1.000.000 (TEUR, Mio.). */
  scale: 1 | 1_000 | 1_000_000;
  unit: FigureUnit;
  /** Kleinste dargestellte Einheit in Millionstel der Grundeinheit. */
  displayUnit: bigint;
  decimals: number;
  periodHint: PeriodHint | null;
  /** Zahlenformat nicht lesbar („1.344.989,.19“); die Zahl bleibt grau markiert. */
  issue: "unreadable_format" | null;
  /** Steht in Klammern (Vorjahresangabe oder „davon“-Wert). */
  parenthesized: boolean;
};

export type FigureContext = Readonly<{
  /** Blockart aus der Aufbereitung. */
  blockType: string;
  /** Einheit der Tabellenspalte, falls der Block eine Tabellenzelle ist. */
  columnUnit?: { unit: FigureUnit; scale: 1 | 1_000 | 1_000_000 } | null;
  /** Periode der Tabellenspalte. */
  columnPeriod?: PeriodHint | null;
  /** Das Berichtsjahr, um „(2024: …)“ als Vorjahr zu lesen. */
  reportYear?: number | null;
}>;

const monthNames =
  "Januar|Jänner|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember";

/**
 * Kandidat: optionales Vorzeichen, Ziffern mit Tausender-/Dezimalzeichen, auch die
 * fehlerhaften Formen der Berichte („1.795.596.57“, „7 .971“, „1.344.989,.19“).
 */
const candidatePattern =
  /(?<![\p{L}\d.,/])([-–−]\s?)?(\d{1,3}(?:(?:\s?[.,']\s?|[.,])\d{1,3})*(?:[.,]\.?\d+)?|\d+(?:[.,]\d+)?)(?!\d)/gu;

/** Wörter vor einer Zahl, nach denen sie ein Verweis und kein Betrag ist. */
const referencePrefix =
  /(?:§§?|Abs\.?|Absatz|Nr\.|Art\.|Artikel|Satz|S\.|Ziffer|Ziff\.|Z|Tz\.?|Rz\.?|lit\.|AFRAC|KFS\/\w+|Teil|Titel|Kapitel|Punkt(?:es)?\.?|Abschnitte?s?|Absätze?n?|Absatzes|ARTIKEL|Anlage|Beilage|Seite|Seiten|Posten|Aktivposten|Passivposten|HRB|HRA|UR-Nr\.|PS|ISA|IFRS|IAS|IDW|CRR|Verordnung \(EU\)|\(EU\)|Richtlinie|Mandant|Buchungskreis|Tel\.:?|Fax:?|Anhang S\.|Stufe)\s*$/u;

/** Wörter, nach denen ein abgesetzter Strich ein Minuszeichen ist („Steuern von - 380 TEUR“). */
const signPrefix =
  /(?:\b(?:von|auf|um|mit|bei|beträgt|betrug|betragen|betrugen|Höhe|ca\.|rund|knapp|Vorjahr|Vj\.)|:|\()\s*$/u;

/** Einheiten direkt vor der Zahl. */
const prefixUnits: Array<{ pattern: RegExp; unit: FigureUnit; scale: 1 | 1_000 | 1_000_000 }> = [
  { pattern: /(?:TEUR|T€|Tsd\.\s?€|Tsd\.\s?EUR)\s*$/u, unit: "EUR", scale: 1_000 },
  { pattern: /(?:Mio\.\s?EUR|Mio\.\s?€)\s*$/u, unit: "EUR", scale: 1_000_000 },
  { pattern: /(?:EUR|€)\s*$/u, unit: "EUR", scale: 1 },
];

/** Einheiten direkt nach der Zahl. */
const suffixUnits: Array<{ pattern: RegExp; unit: FigureUnit; scale: 1 | 1_000 | 1_000_000 }> = [
  { pattern: /^\s*(?:TEUR|T\s?€|Tsd\.\s?€|Tsd\.\s?EUR)/u, unit: "EUR", scale: 1_000 },
  {
    pattern: /^\s*(?:Mio\.?|Millionen|Mrd\.?)\s?(?:EUR|€)?/u,
    unit: "EUR",
    scale: 1_000_000,
  },
  { pattern: /^\s*(?:EUR|€)/u, unit: "EUR", scale: 1 },
  { pattern: /^\s*(?:%|Prozent|%-Punkte|Prozentpunkte)/u, unit: "percent", scale: 1 },
];

/**
 * Fortsetzung einer Verweiskette: „§ 56 (2) und (3)“, „§ 63 Abs 4 und 5“,
 * „Art. 4 Abs. 1 Nr. 3“. Nach dem Verweiswort folgen nur Nummern, geklammerte Absätze,
 * Buchstaben und Bindewörter bis zur Zahl.
 */
const referenceChain = new RegExp(
  `${referencePrefix.source.replace(/\\s\*\$$/u, "")}\\s*(?:(?:\\d+[a-z]?\\.?|\\(\\s*\\d+[a-z]?\\s*\\)|[a-z]\\)|und|bis|sowie|oder|[-–]|iVm|i\\.\\s?V\\.\\s?m\\.|ff?\\.|,|Abs\\.?|Z|Rz\\.?|lit\\.|Satz|S\\.|Nr\\.)\\s*)*\\(?\\s*$`,
  "u",
);

/** Hausnummer nach einem Straßennamen („Wagramer Straße 19“, „Hauptstr. 4“). */
const streetPrefix = /(?:[Ss]tra(?:ß|ss)e|[Ss]tr\.|[Gg]asse|[Ww]eg|[Pp]latz|[Aa]llee)\s*$/u;

/** Ziffern einer Telefon- oder Faxnummer („Tel.: [43] (1) 211 70“). */
const phonePrefix = /(?<!\p{L})(?:Tel(?:efon)?|Fax|Mobil|Phone)\.?\s*:?\s*[\d\s()[\]+/.-]*$/iu;

function isExcludedContext(
  text: string,
  start: number,
  end: number,
  raw: string,
  tableCell: boolean,
) {
  const before = text.slice(Math.max(0, start - 40), start);
  const after = text.slice(end, end + 30);
  if (referencePrefix.test(before)) return true;
  if (referenceChain.test(text.slice(Math.max(0, start - 60), start))) return true;
  if (streetPrefix.test(before) && /^\d{1,4}$/u.test(raw) && !/^\s*(?:TEUR|EUR|€|%)/u.test(after)) {
    return true;
  }
  if (phonePrefix.test(text.slice(Math.max(0, start - 50), start))) return true;
  // Absatzmarken und ihre Bereiche: „(2) bekannt gegeben“, „(7) bis (9)“, „(2)-(4)“.
  // In Tabellen sind Klammerwerte Vorjahres- oder davon-Werte.
  if (!tableCell && /^\d{1,2}$/u.test(raw) && text[start - 1] === "(" && text[end] === ")") {
    if (start === 1) return true;
    if (/^\)\s*(?:bis|und|oder|,|[-–])\s*\(\d/u.test(text.slice(end, end + 12))) return true;
    if (/\(\d{1,2}\)\s*(?:bis|und|oder|,|[-–])\s*\($/u.test(before)) return true;
  }
  // Teil eines Wortes: „12-Monats-Verlust“, „3-Jahres-Zeitraum“.
  if (/^[-–]\p{L}/u.test(after)) return true;
  // Datumsangaben: 31.12.2021, 31. Dezember 2021, 1.1.2022, 0.00 Uhr
  if (/^\d{1,2}\.\d{1,2}\.(?:\d{2,4})?$/u.test(raw.replace(/\s/gu, ""))) return true;
  if (new RegExp(`^\\s*\\.?\\s*(?:${monthNames})\\b`, "iu").test(after)) return true;
  if (new RegExp(`(?:${monthNames})\\s*$`, "iu").test(before)) return true;
  // Postleitzahl vor einem Ortsnamen („40880 Ratingen“, „1220 Wien“)
  if (
    /^\d{4,5}$/u.test(raw) &&
    /^\s+\p{Lu}\p{Ll}+/u.test(after) &&
    !/^\s+(?:TEUR|EUR)/u.test(after)
  ) {
    return true;
  }
  if (/^\s*Uhr\b/u.test(after)) return true;
  if (/\d{1,2}\.\s*$/u.test(before) && /^\d{1,2}$/u.test(raw)) return true;
  // Jahreszahlen ohne Einheit und Trennzeichen
  if (/^(?:19|20)\d{2}$/u.test(raw) && !/^\s*(?:TEUR|EUR|€|%|Mio)/u.test(after)) return true;
  // Kennungen mit Schrägstrich (UR-Nr. 508/2021, 2024/1623, 575/2013)
  if (/^\s*\/\s*\d/u.test(after) || /\d\s*\/\s*$/u.test(before)) return true;
  // Seitenangaben „Seite 1 von 8“, „- 2 -“
  if (/^\s*von\s+\d/u.test(after) && /Seite\s*$/u.test(before)) return true;
  if (/^[-–]\s*$/u.test(before.slice(-2)) && /^\s*[-–]\s*$/u.test(after)) return true;
  // Aufzählungen „a) 1.“, Mengen wie „4a“, Zeitspannen „5 Jahre“ bleiben Anzahlen
  return false;
}

/**
 * Wandelt die Ziffernfolge eines Berichts in einen exakten Wert. Deutsches Format
 * (1.234.567,89), englisches Format (194,508.62) und die Tippfehler der Berichte
 * (1.795.596.57, 7 .971) werden gelesen; was mehrdeutig bleibt, ist `null`.
 */
export function parseNumber(raw: string): { digits: bigint; decimals: number } | null {
  const compact = raw.replace(/[\s']/gu, "");
  if (/[.,]{2}/u.test(compact) || /^[.,]|[.,]$/u.test(compact)) return null;
  const separators = [...compact.matchAll(/[.,]/gu)].map((match) => ({
    char: match[0],
    index: match.index,
  }));
  let decimalIndex = -1;
  if (separators.length > 0) {
    const last = separators.at(-1)!;
    const trailing = compact.length - last.index - 1;
    const commas = separators.filter((separator) => separator.char === ",");
    const dots = separators.filter((separator) => separator.char === ".");
    if (commas.length === 1 && last.char === ",") {
      decimalIndex = last.index;
    } else if (dots.length === 1 && last.char === "." && commas.length > 0) {
      decimalIndex = last.index; // 194,508.62
    } else if (commas.length === 0 && dots.length > 1 && trailing === 2) {
      decimalIndex = last.index; // 1.795.596.57
    } else if (commas.length === 0 && dots.length === 1 && trailing !== 3) {
      decimalIndex = last.index; // 2.5 (selten, englisch)
    } else if (commas.length > 1 && last.char === ",") {
      return null;
    }
    // Tausendergruppen müssen dreistellig sein.
    const integerPart = decimalIndex >= 0 ? compact.slice(0, decimalIndex) : compact;
    const groups = integerPart.split(/[.,]/u);
    if (groups.length > 1 && groups.slice(1).some((group) => group.length !== 3)) return null;
  }
  const integer = (decimalIndex >= 0 ? compact.slice(0, decimalIndex) : compact).replace(
    /[.,]/gu,
    "",
  );
  const fraction = decimalIndex >= 0 ? compact.slice(decimalIndex + 1) : "";
  if (!/^\d+$/u.test(integer) || (fraction && !/^\d+$/u.test(fraction))) return null;
  return { digits: BigInt(`${integer}${fraction}`), decimals: fraction.length };
}

function periodFromText(text: string, start: number, reportYear: number | null | undefined) {
  const before = text.slice(Math.max(0, start - 30), start);
  const yearMatch = /\((?:\s*)((?:19|20)\d{2})\s*:\s*(?:[A-Z€]{1,4}\s*)?$/u.exec(before);
  if (yearMatch && reportYear) {
    const year = Number(yearMatch[1]);
    return year === reportYear - 1 ? "prior" : year === reportYear ? "current" : "other";
  }
  if (
    /(?:Vorjahr(?:es)?(?:wert)?|Vj\.?|i\.\s?Vj\.?|VJ)\s*:?\s*(?:[A-Z€]{1,4}\s*)?$/u.test(before) ||
    /(?:Vorjahr|Vj\.?)\s+(?!(?:um|auf|von|nach|gegenüber|mit|bei)\s)[\p{L}-]+\s*(?:[A-Z€]{1,4}\s*)?$/u.test(
      before,
    )
  ) {
    return "prior";
  }
  return null;
}

function unitAround(text: string, start: number, end: number) {
  // „TEUR -3.430“: die Einheit steht vor dem Vorzeichen.
  const before = text.slice(Math.max(0, start - 14), start).replace(/[-–−]\s?$/u, "");
  const after = text.slice(end, end + 16);
  for (const entry of suffixUnits) {
    const match = entry.pattern.exec(after);
    if (match) {
      // „EUR 402,7 Millionen“: Einheit davor, Größenordnung danach.
      if (entry.scale === 1_000_000 && /EUR\s*$/u.test(before)) {
        return { unit: "EUR" as const, scale: 1_000_000 as const, length: match[0].length };
      }
      return { unit: entry.unit, scale: entry.scale, length: match[0].length };
    }
  }
  for (const entry of prefixUnits) {
    if (entry.pattern.test(before)) return { unit: entry.unit, scale: entry.scale, length: 0 };
  }
  return null;
}

function scaledMicro(digits: bigint, decimals: number, scale: number) {
  return (digits * microPerUnit * BigInt(scale)) / 10n ** BigInt(decimals);
}

function displayUnitOf(decimals: number, scale: number) {
  return (microPerUnit * BigInt(scale)) / 10n ** BigInt(decimals);
}

/**
 * Seitenzahl am Ende einer kurzen Gliederungszeile, die die Erkennung des
 * Inhaltsverzeichnisses nicht erfasst hat: „Erteilte Auskünfte 3“,
 * „Bestätigungsvermerk 4-11“. Gibt den Beginn dieser Seitenangabe zurück.
 */
function trailingPageStart(text: string, tableCell: boolean) {
  if (tableCell || text.length > 120 || /[.;:!?]\s/u.test(text)) return null;
  const match = /(?<=[\p{L})]\s{1,6})\d{1,3}(?:\s?[-–]\s?\d{1,3})?\s*$/u.exec(text);
  return match ? match.index : null;
}

/** Alle Zahlen eines Blocks, ohne Überlappung, in Textreihenfolge. */
export function recognizeFigures(text: string, context: FigureContext): RecognizedFigure[] {
  if (/^PDF-Seite \d+$/u.test(text.trim())) return [];
  const figures: RecognizedFigure[] = [];
  const tableCell = context.blockType === "table_cell";
  const pageStart = trailingPageStart(text, tableCell);
  for (const match of text.matchAll(candidatePattern)) {
    const signText = match[1] ?? "";
    const numberText = match[2]!;
    const start = match.index;
    const end = start + match[0].length;
    const numberStart = start + signText.length;
    const trimmedNumber = numberText.trim();
    // Minus nur, wenn es nicht als Gedankenstrich zwischen Wörtern steht. Nach
    // „von“, „auf“, „um“ oder einem Doppelpunkt ist „- 380“ ein Vorzeichen.
    const precededByWord = /[\p{L}\d]\s?$/u.test(text.slice(Math.max(0, start - 2), start));
    const signWord = signPrefix.test(text.slice(Math.max(0, start - 24), start));
    const negative =
      signText !== "" && (signWord || !(precededByWord && /\s/u.test(text[start + 1] ?? "")));
    if (isExcludedContext(text, numberStart, end, trimmedNumber, tableCell)) continue;
    if (pageStart !== null && numberStart >= pageStart) continue;
    // Randziffern und Gliederungsnummern am Blockanfang („62 Insgesamt …“, „1. Umsatzerlöse“).
    if (
      start === 0 &&
      /^\d{1,3}\.?$/u.test(trimmedNumber) &&
      /^\.?\s+\p{L}/u.test(text.slice(end))
    ) {
      continue;
    }
    if (context.blockType === "heading" && start < 8) continue;
    const parsed = parseNumber(trimmedNumber);
    const unitMatch = unitAround(text, numberStart, end);
    const columnUnit = tableCell ? context.columnUnit : null;
    const unit = unitMatch?.unit ?? columnUnit?.unit ?? (tableCell ? "unknown" : "count");
    const scale = unitMatch?.scale ?? columnUnit?.scale ?? 1;
    const parenthesized =
      /\(\s*(?:[^()]{0,24}:)?\s*(?:[A-Z€]{1,4}\s*)?$/u.test(
        text.slice(Math.max(0, start - 30), start),
      ) && /^\s*(?:[A-Z€%]{1,4}\.?)?\s*\)/u.test(text.slice(end, end + 8));
    const periodHint = tableCell
      ? (context.columnPeriod ?? null)
      : periodFromText(text, start, context.reportYear);
    const rawStart = negative ? start : numberStart;
    const raw = text.slice(rawStart, end).trim();
    if (!parsed) {
      figures.push({
        start: rawStart,
        end,
        raw,
        micro: null,
        scale,
        unit,
        displayUnit: 0n,
        decimals: 0,
        periodHint,
        issue: "unreadable_format",
        parenthesized,
      });
      continue;
    }
    const magnitude = scaledMicro(parsed.digits, parsed.decimals, scale);
    figures.push({
      start: rawStart,
      end,
      raw,
      micro: negative ? -magnitude : magnitude,
      scale,
      unit,
      displayUnit: displayUnitOf(parsed.decimals, scale),
      decimals: parsed.decimals,
      periodHint,
      issue: null,
      parenthesized,
    });
  }
  return inheritUnits(text, figures);
}

/**
 * Eine Zahl ohne eigene Einheit übernimmt die der nächsten Zahl desselben Satzes,
 * wenn beide eng zusammenstehen: „Fremdkapital von 5.187 (Vorjahr: 5.197 TEUR)“.
 */
function inheritUnits(text: string, figures: RecognizedFigure[]) {
  return figures.map((figure, index) => {
    if (figure.unit !== "count") return figure;
    const neighbours = [figures[index + 1], figures[index - 1]].filter(
      (neighbour): neighbour is RecognizedFigure =>
        neighbour !== undefined && neighbour.unit === "EUR",
    );
    for (const neighbour of neighbours) {
      const between = text.slice(
        Math.min(figure.end, neighbour.end),
        Math.max(figure.start, neighbour.start),
      );
      if (between.length <= 40 && !/[.;!?](?:\s|$)/u.test(between)) {
        const decimals = figure.decimals;
        const digits = figure.micro === null ? null : figure.micro;
        return {
          ...figure,
          unit: "EUR" as const,
          scale: neighbour.scale,
          micro: digits === null ? null : digits * BigInt(neighbour.scale),
          displayUnit: displayUnitOf(decimals, neighbour.scale),
        };
      }
    }
    return figure;
  });
}
