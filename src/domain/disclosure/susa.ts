import { microPerUnit } from "./arithmetic";
import { normalizeLabel, postenByKey, postenCatalogue, postenOfRowLabel } from "./checks/posten";

/**
 * Summen- und Saldenliste (SuSa) als Beleg des Plausichecks. Reine Funktionen: der
 * Server liest das Excel-Blatt als Zellraster, hier werden Kopfzeile, Konten und Salden
 * erkannt und jedes Konto über seine Bezeichnung einem Posten des Code-Katalogs
 * zugeordnet. Beträge sind wie überall `bigint` in Millionstel der Grundeinheit.
 */

export const susaParserVersion = "susa-v1";

/** Ein Zellwert, wie der Server ihn aus dem Blatt liest. */
export type SheetValue = string | number | null;

export type SusaAccount = {
  /** Zeilennummer im Blatt, 1-basiert wie in Excel. */
  row: number;
  accountNumber: string;
  label: string;
  opening: bigint | null;
  debit: bigint | null;
  credit: bigint | null;
  /** Saldo: Soll positiv, Haben negativ. */
  closing: bigint;
};

export type SusaParseResult =
  | { ok: true; headerRow: number; accounts: SusaAccount[]; skippedRows: number }
  | { ok: false; code: "SUSA_HEADER_NOT_FOUND" | "SUSA_NO_ACCOUNTS" };

type Column =
  | "account"
  | "label"
  | "opening"
  | "debit"
  | "credit"
  | "closing"
  | "closingDebit"
  | "closingCredit"
  | "side";

/** Kopfbegriffe gängiger Exporte (DATEV als Referenz), klein und ohne Satzzeichen. */
const headerPatterns: ReadonlyArray<[Column, RegExp]> = [
  ["account", /^(?:konto|kontonummer|konto nr|kontonr|kto|kto nr|ktonr|sachkonto|account)$/u],
  ["label", /^(?:bezeichnung|kontobezeichnung|kontenbezeichnung|beschriftung|kontoname|name)$/u],
  [
    "opening",
    /^(?:eb|eb wert|ebwert|eröffnungsbilanz|eröffnungssaldo|anfangsbestand|vortrag|saldovortrag)$/u,
  ],
  ["closingDebit", /^(?:saldo soll|endsaldo soll)$/u],
  ["closingCredit", /^(?:saldo haben|endsaldo haben)$/u],
  ["debit", /^(?:soll|umsatz soll|soll umsatz|summe soll|verkehrszahlen soll|jvz soll)$/u],
  ["credit", /^(?:haben|umsatz haben|haben umsatz|summe haben|verkehrszahlen haben|jvz haben)$/u],
  ["closing", /^(?:saldo|endsaldo|schlusssaldo|saldo neu|saldo aktuell|endbestand)$/u],
  ["side", /^(?:s h|soll haben|sh)$/u],
];

function headerKey(value: SheetValue) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[./:_\-–]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function detectHeader(row: readonly SheetValue[]) {
  const columns = new Map<Column, number>();
  row.forEach((value, index) => {
    const key = headerKey(value);
    if (!key) return;
    const match = headerPatterns.find(([, pattern]) => pattern.test(key));
    if (match && !columns.has(match[0])) columns.set(match[0], index);
  });
  const hasBalance =
    columns.has("closing") ||
    (columns.has("closingDebit") && columns.has("closingCredit")) ||
    (columns.has("debit") && columns.has("credit"));
  return columns.has("account") && columns.has("label") && hasBalance ? columns : null;
}

const centsToMicro = microPerUnit / 100n;

/**
 * Ein Betrag aus einer Zelle: eine Zahl aus Excel (auf Cent gerundet, weil Excel Dezimal-
 * zahlen binär speichert) oder deutscher Text wie „1.234,56“, „-1.234,56“, „1.234,56 H“.
 * Gibt `null` für leere oder unlesbare Zellen zurück, nie einen geratenen Wert.
 */
export function parseSusaAmount(
  value: SheetValue,
): { micro: bigint; side: "S" | "H" | null } | null {
  if (value === null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return { micro: BigInt(Math.round(value * 100)) * centsToMicro, side: null };
  }
  const text = value.replace(/\s+/gu, " ").trim();
  const match = /^([-–]?)\s*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?)\s*([SH])?$/u.exec(text);
  if (!match) return null;
  const [, sign, , cents = "", side] = match;
  const whole = match[2]!.split(",")[0]!.replace(/\./gu, "");
  const total = BigInt(whole) * 100n + BigInt(cents.padEnd(2, "0") || "0");
  return {
    micro: (sign ? -total : total) * centsToMicro,
    side: (side as "S" | "H" | undefined) ?? null,
  };
}

function signed(amount: { micro: bigint; side: "S" | "H" | null }, side: SheetValue) {
  const marker =
    amount.side ??
    (String(side ?? "")
      .trim()
      .toUpperCase()
      .startsWith("H")
      ? "H"
      : null);
  return marker === "H" && amount.micro > 0n ? -amount.micro : amount.micro;
}

/**
 * Liest ein Blatt: die erste Zeile unter den obersten 20, die Konto, Bezeichnung und
 * einen Saldo (oder Soll und Haben) benennt, ist die Kopfzeile. Kontozeilen haben eine
 * Kontonummer aus Ziffern; Summen- und Klassenzeilen ohne Nummer werden übersprungen.
 */
export function parseSusaRows(rows: ReadonlyArray<readonly SheetValue[]>): SusaParseResult {
  let header: { index: number; columns: Map<Column, number> } | null = null;
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const columns = detectHeader(rows[index] ?? []);
    if (columns) {
      header = { index, columns };
      break;
    }
  }
  if (!header) return { ok: false, code: "SUSA_HEADER_NOT_FOUND" };
  const column = (row: readonly SheetValue[], name: Column) => {
    const index = header!.columns.get(name);
    return index === undefined ? null : (row[index] ?? null);
  };

  const accounts: SusaAccount[] = [];
  let skippedRows = 0;
  for (let index = header.index + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const accountNumber = String(column(row, "account") ?? "").trim();
    if (!/^\d{3,9}$/u.test(accountNumber)) {
      if (row.some((value) => value !== null && value !== "")) skippedRows += 1;
      continue;
    }
    const label = String(column(row, "label") ?? "")
      .replace(/\s+/gu, " ")
      .trim();
    const opening = parseSusaAmount(column(row, "opening"));
    const debit = parseSusaAmount(column(row, "debit"));
    const credit = parseSusaAmount(column(row, "credit"));
    const closingValue = parseSusaAmount(column(row, "closing"));
    const closingDebit = parseSusaAmount(column(row, "closingDebit"));
    const closingCredit = parseSusaAmount(column(row, "closingCredit"));
    let closing: bigint | null = null;
    if (closingValue) {
      closing = signed(closingValue, column(row, "side"));
    } else if (closingDebit || closingCredit) {
      closing = (closingDebit?.micro ?? 0n) - (closingCredit?.micro ?? 0n);
    } else if (debit || credit) {
      closing =
        (opening ? signed(opening, null) : 0n) + (debit?.micro ?? 0n) - (credit?.micro ?? 0n);
    }
    if (closing === null || !label) {
      skippedRows += 1;
      continue;
    }
    accounts.push({
      row: index + 1,
      accountNumber,
      label: label.slice(0, 200),
      opening: opening ? signed(opening, null) : null,
      debit: debit?.micro ?? null,
      credit: credit?.micro ?? null,
      closing,
    });
  }
  if (accounts.length === 0) return { ok: false, code: "SUSA_NO_ACCOUNTS" };
  return { ok: true, headerRow: header.index + 1, accounts, skippedRows };
}

/** Kontenbezeichnungen, die der Postenkatalog nicht als Zeilenlabel kennt. */
const accountSynonyms: ReadonlyArray<[RegExp, string]> = [
  [
    /^(?:bank(?:en)?|kasse|kassenbestand|kreditinstitute?|guthaben bei (?:kreditinstituten|banken))(?:\s|$)/iu,
    "liquide_mittel",
  ],
];

/**
 * Sammelposten, denen ein einzelnes Konto nie allein zugeordnet wird: eine SuSa zeigt
 * dort nur einen Teil („Sonstige Rückstellungen“ ist nicht „Rückstellungen“).
 */
const aggregatePosten = new Set([
  "bilanzsumme",
  "anlagevermoegen",
  "umlaufvermoegen",
  "eigenkapital",
  "fremdkapital",
  "rueckstellungen",
  "verbindlichkeiten",
]);

/**
 * Der Posten eines Kontos aus seiner Bezeichnung: erst genau wie ein Zeilenlabel der
 * Bilanz oder GuV, dann über wenige Synonyme, dann über die Textnennung eines
 * Einzelpostens. Kontonummern entscheiden nicht, weil SKR03 und SKR04 sie verschieden
 * belegen (1200 ist dort Bank, hier Forderungen).
 */
export function postenOfAccount(label: string) {
  const normalized = normalizeLabel(label);
  const row = postenOfRowLabel(normalized);
  if (row) return aggregatePosten.has(row.key) ? null : row;
  for (const [pattern, key] of accountSynonyms) {
    if (pattern.test(normalized)) return postenByKey.get(key) ?? null;
  }
  return (
    postenCatalogue.find(
      (posten) =>
        !aggregatePosten.has(posten.key) &&
        posten.kind !== "ratio" &&
        posten.kind !== "result" &&
        posten.text.test(normalized),
    ) ?? null
  );
}
