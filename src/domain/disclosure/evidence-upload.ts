import { hasZipEntries } from "@/domain/policies/upload";

/**
 * Belegdateien der Offenlegungspflicht: derzeit nur die Summen- und Saldenliste als
 * Excel-Datei. Client und Server prüfen dieselben Regeln; der Server zusätzlich den
 * Inhalt (ZIP-Signatur und `xl/workbook.xml`).
 */

export const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 10 MB; über dem Vercel-Body-Limit, deshalb Direktupload in den Blob. */
export const maximumEvidenceBytes = 10 * 1024 * 1024;

export function isXlsxFile(name: string) {
  return name.toLowerCase().endsWith(".xlsx");
}

/** Eine echte Excel-Arbeitsmappe: ZIP-Signatur und die Pflichteinträge des Pakets. */
export function isXlsxPackage(bytes: Uint8Array) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04 &&
    hasZipEntries(bytes, ["[Content_Types].xml", "xl/workbook.xml"])
  );
}

/** Dateiname ohne Pfad und Steuerzeichen, höchstens 255 Zeichen. */
export function sanitizeEvidenceFilename(name: string) {
  const base = name.split(/[\\/]/u).pop() ?? "";
  return base
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 255);
}
