import { formatMicro } from "./arithmetic";
import { formatAmount } from "./checks/comments";
import type { FigureUnit } from "./figures";

/**
 * Übernahme korrigierter Zahlen (D-034): nur Zahlen, nie Text. Ein eingegebener Wert
 * wird in der Darstellung der geprüften Zahl gelesen — „932,9“ bei einer TEUR-Zahl ist
 * 932.900 EUR — und exakt als `bigint` in Millionstel der Grundeinheit gespeichert.
 */

export type FigureFormat = Readonly<{ unit: FigureUnit; scale: number; decimals: number }>;

export const reviewStatuses = ["open", "prepared", "reviewed"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

/**
 * Liest einen eingegebenen Betrag: optionales Minus, Tausenderpunkte, Dezimalkomma, höchstens
 * sechs Nachkommastellen. Alles andere — Buchstaben, Einheiten, Rechenausdrücke — ist kein
 * Betrag und wird abgewiesen.
 */
export function parseAcceptedValue(input: string, format: FigureFormat): bigint | null {
  const text = input.replace(/\s+/gu, "").replace(/−|–/gu, "-");
  const match = /^(-?)((?:\d{1,3}(?:\.\d{3})+|\d+))(?:,(\d+))?$/u.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > 6) return null;
  const scale = BigInt(format.unit === "EUR" ? format.scale : 1);
  const digits = BigInt(whole!.replace(/\./gu, "") + fraction.padEnd(6, "0"));
  const micro = digits * scale;
  return sign ? -micro : micro;
}

/** Der Wert in der Darstellung der geprüften Zahl, etwa „933.929,51 EUR“. */
export function formatAcceptedValue(micro: bigint, format: FigureFormat) {
  return formatAmount(micro, format).trim();
}

/** Der Eingabewert ohne Einheit, wie ihn das Feld vorbelegt („933.929,51“, „932,9“). */
export function editableValue(micro: bigint, format: FigureFormat) {
  const scale = BigInt(format.unit === "EUR" ? format.scale : 1);
  return formatMicro(micro / scale, Math.min(6, format.decimals));
}
