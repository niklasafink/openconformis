/**
 * Exakte Dezimalarithmetik für den Plausicheck. Beträge sind `bigint` in
 * Millionstel der Grundeinheit (EUR, Prozentpunkt oder Stück): so lassen sich Cent,
 * TEUR mit einer Nachkommastelle und „Mio.“ ohne Rundung auf einer Skala vergleichen.
 * Kein `number`, kein Float, keine Modellarithmetik.
 */

/** 1 Grundeinheit = 1.000.000 Mikroeinheiten. */
export const microPerUnit = 1_000_000n;

export type Amount = Readonly<{
  /** Wert in Millionstel der Grundeinheit. */
  micro: bigint;
  /** Kleinste dargestellte Einheit in Mikroeinheiten, z. B. 100.000.000 für „4.416,4 TEUR“. */
  displayUnit: bigint;
}>;

export function sum(values: readonly bigint[]) {
  return values.reduce((total, value) => total + value, 0n);
}

export function abs(value: bigint) {
  return value < 0n ? -value : value;
}

/**
 * Die Rundungsregel des Plausichecks: Eine Abweichung bis zu einer Anzeigeeinheit
 * der gröber dargestellten Zahl gilt als gerundet und stimmt; darüber ist sie falsch.
 * `terms` ist die Zahl gerundeter Summanden: bei einer Summe aus n gerundeten Werten
 * darf sich die Rundung n-mal aufaddieren.
 */
export function compareWithTolerance(
  actual: Amount,
  expected: Amount,
  terms = 1,
): { status: "match" | "mismatch"; rounded: boolean; difference: bigint; tolerance: bigint } {
  const unit =
    actual.displayUnit > expected.displayUnit ? actual.displayUnit : expected.displayUnit;
  const tolerance = unit * BigInt(Math.max(1, terms));
  const difference = actual.micro - expected.micro;
  if (difference === 0n) return { status: "match", rounded: false, difference, tolerance };
  return abs(difference) <= tolerance
    ? { status: "match", rounded: true, difference, tolerance }
    : { status: "mismatch", rounded: false, difference, tolerance };
}

/**
 * Rundet halb von null weg auf ein Vielfaches von `unit` — so, wie ein Bericht einen
 * genauen Betrag in TEUR mit einer Nachkommastelle zeigt.
 */
export function roundTo(value: bigint, unit: bigint) {
  if (unit <= 0n) return value;
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const rounded = ((magnitude + unit / 2n) / unit) * unit;
  return negative ? -rounded : rounded;
}

/**
 * Quote in Mikroprozentpunkten (Anteil × 100 × 10⁶), halb von null weg gerundet.
 * `null`, wenn der Nenner null ist.
 */
export function ratioPercentMicro(numerator: bigint, denominator: bigint) {
  if (denominator === 0n) return null;
  const scaled = numerator * 100n * microPerUnit;
  const negative = scaled < 0n !== denominator < 0n;
  const a = abs(scaled);
  const b = abs(denominator);
  const quotient = (a * 2n + b) / (b * 2n);
  return negative ? -quotient : quotient;
}

/** Richtung der Veränderung von A nach C. */
export function directionOf(from: bigint, to: bigint): "up" | "down" | "flat" {
  if (to > from) return "up";
  if (to < from) return "down";
  return "flat";
}

/** Formatiert Mikroeinheiten deutsch mit fester Nachkommazahl, etwa für Kommentare. */
export function formatMicro(value: bigint, decimals: number, suffix = "") {
  const negative = value < 0n;
  const unit = 10n ** BigInt(6 - Math.min(6, decimals));
  const rounded = roundTo(abs(value), unit) / unit;
  const digits = rounded.toString().padStart(decimals + 1, "0");
  const integer = digits.slice(0, digits.length - decimals) || "0";
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : "";
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  return `${negative ? "-" : ""}${grouped}${fraction ? `,${fraction}` : ""}${suffix}`;
}
