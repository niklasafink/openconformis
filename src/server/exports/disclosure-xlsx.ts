import ExcelJS from "exceljs";

import { safeExcelText } from "./analysis-xlsx";

/**
 * Export des Plausichecks: ein Blatt „Feststellungen“ mit Ist, Soll, Quelle, übernommenem
 * Wert, Freigabestatus und Verlauf, ein Blatt „Verlauf“ mit jedem Ereignis. Der
 * Dokumenttext selbst wird nie verändert; der übernommene Wert steht neben dem Ist-Wert.
 */

type ExportLocale = "de" | "en";

export type DisclosureExportFinding = {
  ordinal: number;
  title: string;
  severity: "mismatch" | "uncertain";
  page: number | null;
  tz: string | null;
  checkKind: string;
  actual: string | null;
  expected: string | null;
  source: string;
  comment: string;
  reviewStatus: "open" | "prepared" | "reviewed";
  acceptedValue: string | null;
  acceptedReason: string | null;
  preparedBy: string | null;
  preparedAt: Date | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  history: Array<{ kind: string; actor: string; at: Date; body: string | null }>;
};

export type DisclosureExportData = {
  runId: string;
  caseTitle: string;
  locale: ExportLocale;
  completedAt: Date | null;
  findings: DisclosureExportFinding[];
};

const labels = {
  de: {
    sheet: "Feststellungen",
    history: "Verlauf",
    headers: [
      "Nr.",
      "Feststellung",
      "Status",
      "Seite",
      "Tz",
      "Prüfung",
      "Ist",
      "Soll",
      "Quelle",
      "Kommentar",
      "Freigabestatus",
      "Übernommener Wert",
      "Begründung",
      "Vorbereitet von",
      "Vorbereitet am",
      "Freigegeben von",
      "Freigegeben am",
    ],
    historyHeaders: ["Nr.", "Feststellung", "Ereignis", "Person", "Zeitpunkt", "Text"],
    severity: { mismatch: "Abweichung (rot)", uncertain: "Unsicher (orange)" },
    review: { open: "offen", prepared: "vorbereitet", reviewed: "geprüft" },
    event: {
      accepted: "übernommen",
      confirmed: "Ist bestätigt",
      released: "freigegeben",
      rejected: "abgelehnt",
      comment: "Kommentar",
    } as Record<string, string>,
  },
  en: {
    sheet: "Findings",
    history: "History",
    headers: [
      "No.",
      "Finding",
      "Status",
      "Page",
      "Para.",
      "Check",
      "Actual",
      "Expected",
      "Source",
      "Comment",
      "Review status",
      "Accepted value",
      "Reason",
      "Prepared by",
      "Prepared at",
      "Released by",
      "Released at",
    ],
    historyHeaders: ["No.", "Finding", "Event", "Person", "Time", "Text"],
    severity: { mismatch: "Mismatch (red)", uncertain: "Uncertain (orange)" },
    review: { open: "open", prepared: "prepared", reviewed: "reviewed" },
    event: {
      accepted: "accepted",
      confirmed: "actual confirmed",
      released: "released",
      rejected: "rejected",
      comment: "comment",
    } as Record<string, string>,
  },
} as const;

const tone = {
  mismatch: "FFFBE3E3",
  uncertain: "FFFFF1DC",
} as const;

export async function buildDisclosureXlsx(data: DisclosureExportData) {
  const text = labels[data.locale];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpenConformis";
  workbook.created = data.completedAt ?? new Date(0);

  const sheet = workbook.addWorksheet(text.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(text.headers).font = { bold: true };
  for (const finding of data.findings) {
    const row = sheet.addRow(
      [
        finding.ordinal,
        finding.title,
        text.severity[finding.severity],
        finding.page ?? "",
        finding.tz ?? "",
        finding.checkKind,
        finding.actual ?? "",
        finding.expected ?? "",
        finding.source,
        finding.comment,
        text.review[finding.reviewStatus],
        finding.acceptedValue ?? "",
        finding.acceptedReason ?? "",
        finding.preparedBy ?? "",
        finding.preparedAt ?? "",
        finding.reviewedBy ?? "",
        finding.reviewedAt ?? "",
      ].map((value) => (value instanceof Date ? value : safeExcelText(value))),
    );
    // Die Farbe ergänzt das Statuswort in Spalte C, sie ersetzt es nie.
    row.getCell(3).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: tone[finding.severity] },
    };
  }
  const widths = [6, 48, 18, 7, 7, 16, 18, 18, 48, 60, 14, 18, 40, 20, 18, 20, 18];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  for (const column of [15, 17]) sheet.getColumn(column).numFmt = "dd.mm.yyyy hh:mm";

  const history = workbook.addWorksheet(text.history, { views: [{ state: "frozen", ySplit: 1 }] });
  history.addRow(text.historyHeaders).font = { bold: true };
  for (const finding of data.findings) {
    for (const entry of finding.history) {
      history.addRow([
        finding.ordinal,
        safeExcelText(finding.title),
        text.event[entry.kind] ?? entry.kind,
        safeExcelText(entry.actor),
        entry.at,
        safeExcelText(entry.body ?? ""),
      ]);
    }
  }
  [6, 48, 16, 24, 18, 80].forEach((width, index) => {
    history.getColumn(index + 1).width = width;
  });
  history.getColumn(5).numFmt = "dd.mm.yyyy hh:mm";

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export function createDisclosureExportFilename(
  data: Pick<DisclosureExportData, "caseTitle" | "runId">,
) {
  const name = data.caseTitle
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `plausicheck-${name || "pruefung"}-${data.runId.slice(0, 8)}.xlsx`;
}
