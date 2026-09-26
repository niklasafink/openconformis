import ExcelJS from "exceljs";

export type ExportResultStatus =
  | "fulfilled"
  | "partially_fulfilled"
  | "not_fulfilled"
  | "not_applicable"
  | "no_assessment_possible";

export type AnalysisExportData = {
  id: string;
  organizationId: string;
  frameworkSlug: string;
  frameworkReleaseKey: string;
  frameworkContentHash: string;
  institutionSize: "small" | "medium" | "large";
  analysisProfile: "auditor" | "institution";
  organizationContext: string;
  locale: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  routeProvider: string;
  providerModelId: string;
  modelProfileId: string;
  verifierProviderModelId: string;
  verifierModelProfileId: string;
  modelCatalogueVersion: string;
  privacyProfileId: string;
  promptVersion: string;
  verifierPromptVersion: string;
  configurationHash: string;
  policySha256: string;
  policyParserVersion: string;
  requirementCount: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  policy: {
    displayName: string;
    versionNumber: number;
    pageCount: number | null;
  };
  items: Array<{
    id: string;
    regulatoryId: string;
    title: string;
    legalText: string;
    assessmentAspects: string[];
    sourceLocator: string | null;
    sizeGuidance: string;
    contentHash: string;
    subrequirements: Array<{
      externalKey: string;
      regulatoryId: string;
      title: string;
      legalText: string;
    }>;
    aiStatus: ExportResultStatus;
    status: ExportResultStatus;
    override: {
      status: ExportResultStatus;
      reason: string;
      actorUserId: string | null;
      createdAt: Date;
    } | null;
    explanation: string;
    missingInformation: string[];
    confidencePercent: number;
    verificationStatus: "pending" | "not_selected" | "passed" | "needs_review" | "rejected";
    verifierExplanation: string | null;
    confirmedByUserId: string | null;
    confirmedAt: Date | null;
    /** Nur Lücken haben einen Abschlusstext; das Profil bestimmt seine Bedeutung. */
    conclusion: {
      profile: "auditor" | "institution";
      summary: string;
      items: string[];
      resolvedItems: number[];
    } | null;
    evidence: Array<{
      citationOrder: number;
      support: "supports" | "contradicts" | "context";
      exactQuote: string;
      blockTextHash: string;
      pageNumber: number | null;
      paragraphNumber: number | null;
    }>;
  }>;
};

type ExportLocale = "de" | "en";

const maximumExcelCellCharacters = 32_767;
const formulaPrefix = /^[\t\r ]*[=+\-@]/;

const palette = {
  navy: "FF172B4D",
  blue: "FF0C66E4",
  paleBlue: "FFE9F2FF",
  border: "FFDFE1E6",
  subtle: "FFF7F8F9",
  white: "FFFFFFFF",
  text: "FF172B4D",
  muted: "FF626F86",
  green: "FF216E4E",
  paleGreen: "FFDCFFF1",
  amber: "FFA54800",
  paleAmber: "FFFFF3EB",
  red: "FFAE2E24",
  paleRed: "FFFFEDEB",
  grey: "FF596773",
  paleGrey: "FFF1F2F4",
} as const;

const translations = {
  de: {
    results: "Ergebnisse",
    reportTitle: "Gap-Analyse",
    finding: "Feststellung",
    findingImpact: "Auswirkung",
    gapSummary: "Lücke",
    actions: "Maßnahmen",
    regulatoryId: "Regulatorische ID",
    title: "Titel",
    requirement: "Anforderung",
    subrequirements: "Subanforderungen",
    aiStatus: "Ursprünglicher KI-Status",
    finalStatus: "Finaler Status",
    overrideReason: "Begründung der Änderung",
    overriddenAt: "Geändert am",
    reviewer: "Bearbeitet von",
    assessment: "Begründung der Bewertung",
    policyPassages: "Belegstellen in der Policy",
    pageAbbreviation: "S.",
    missingInformation: "Fehlende Informationen",
    confidence: "Konfidenz",
    verification: "Verifikation",
    verifierAssessment: "Begründung der Verifikation",
    evidenceCount: "Belegstellen",
    notAvailable: "–",
    statuses: {
      fulfilled: "Erfüllt",
      partially_fulfilled: "Teilweise erfüllt",
      not_fulfilled: "Nicht erfüllt",
      not_applicable: "Nicht einschlägig",
      no_assessment_possible: "Keine Einschätzung möglich",
    },
  },
  en: {
    results: "Results",
    reportTitle: "Gap analysis",
    finding: "Finding",
    findingImpact: "Impact",
    gapSummary: "Gap",
    actions: "Actions",
    regulatoryId: "Regulatory ID",
    title: "Title",
    requirement: "Requirement",
    subrequirements: "Subrequirements",
    aiStatus: "Original AI status",
    finalStatus: "Final status",
    overrideReason: "Reason for change",
    overriddenAt: "Changed at",
    reviewer: "Reviewed by",
    assessment: "Assessment rationale",
    policyPassages: "Policy passages",
    pageAbbreviation: "p.",
    missingInformation: "Missing information",
    confidence: "Confidence",
    verification: "Verification",
    verifierAssessment: "Verification rationale",
    evidenceCount: "Evidence items",
    notAvailable: "–",
    statuses: {
      fulfilled: "Fulfilled",
      partially_fulfilled: "Partially fulfilled",
      not_fulfilled: "Not fulfilled",
      not_applicable: "Not applicable",
      no_assessment_possible: "No assessment possible",
    },
  },
} as const;

function localeOf(locale: string): ExportLocale {
  return locale.toLowerCase().startsWith("en") ? "en" : "de";
}

export function safeExcelText(value: unknown): string | number | boolean {
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value ?? "");
  const shortened =
    text.length > maximumExcelCellCharacters
      ? `${text.slice(0, maximumExcelCellCharacters - 14)} … [gekürzt]`
      : text;
  return formulaPrefix.test(shortened) ? `'${shortened}` : shortened;
}

function iso(value: Date | null, fallback: string) {
  return value ? value.toISOString() : fallback;
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: palette.text } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.paleBlue } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: palette.border } } };
  });
}

function styleDataRows(sheet: ExcelJS.Worksheet, fromRow: number) {
  for (let rowIndex = fromRow; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell((cell) => {
      if (!cell.font) {
        cell.font = { name: "Aptos", size: 10, color: { argb: palette.text } };
      }
      cell.border = { bottom: { style: "hair", color: { argb: palette.border } } };
    });
  }
}

function statusStyle(status: ExportResultStatus) {
  if (status === "fulfilled") return { color: palette.green, fill: palette.paleGreen };
  if (status === "partially_fulfilled") return { color: palette.amber, fill: palette.paleAmber };
  if (status === "not_fulfilled") return { color: palette.red, fill: palette.paleRed };
  return { color: palette.grey, fill: palette.paleGrey };
}

/**
 * Die im Originaldokument hervorgehobenen Stellen als Stichpunktliste, je Zeile
 * das exakte Zitat in Anführungszeichen mit Seitenzahl dahinter. Die Zeile
 * beginnt mit „-“, deshalb stellt safeExcelText dem ersten Stichpunkt ein
 * Hochkomma voran.
 */
function policyPassages(evidence: AnalysisExportData["items"][number]["evidence"], page: string) {
  return [...evidence]
    .sort((left, right) => left.citationOrder - right.citationOrder)
    .map(({ exactQuote, pageNumber }) => {
      const quote = `- "${exactQuote.replace(/\s+/gu, " ").trim()}"`;
      return pageNumber === null ? quote : `${quote} (${page} ${pageNumber})`;
    })
    .join("\n");
}

function addResults(workbook: ExcelJS.Workbook, data: AnalysisExportData, locale: ExportLocale) {
  const t = translations[locale];
  const auditorProfile = data.analysisProfile === "auditor";
  const sheet = workbook.addWorksheet(t.results, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  sheet.columns = [
    { width: 24 },
    { width: 34 },
    { width: 74 },
    { width: 62 },
    { width: 24 },
    { width: 24 },
    { width: 54 },
    { width: 24 },
    { width: 34 },
    { width: 72 },
    { width: 80 },
    { width: 44 },
    { width: 76 },
    { width: 54 },
    { width: 14 },
    { width: 22 },
    { width: 54 },
    { width: 14 },
  ];
  const headers = [
    t.regulatoryId,
    t.title,
    t.requirement,
    t.subrequirements,
    t.aiStatus,
    t.finalStatus,
    t.overrideReason,
    t.overriddenAt,
    t.reviewer,
    t.assessment,
    t.policyPassages,
    t.missingInformation,
    // Beide Profile schreiben in dieselben zwei Spalten; die Überschrift sagt,
    // was darin steht.
    auditorProfile ? t.finding : t.gapSummary,
    auditorProfile ? t.findingImpact : t.actions,
    t.confidence,
    t.verification,
    t.verifierAssessment,
    t.evidenceCount,
  ];
  const header = sheet.addRow(headers.map(safeExcelText));
  styleHeader(header);

  for (const item of data.items) {
    const subrequirements = item.subrequirements
      .map((subrequirement) => `${subrequirement.regulatoryId}\n${subrequirement.legalText}`)
      .join("\n\n");
    const row = sheet.addRow(
      [
        item.regulatoryId,
        item.title,
        item.legalText,
        subrequirements,
        t.statuses[item.aiStatus],
        t.statuses[item.status],
        item.override?.reason ?? t.notAvailable,
        iso(item.override?.createdAt ?? null, t.notAvailable),
        item.override?.actorUserId ?? t.notAvailable,
        item.explanation,
        policyPassages(item.evidence, t.pageAbbreviation) || t.notAvailable,
        item.missingInformation.join("\n"),
        item.conclusion?.summary ?? t.notAvailable,
        item.conclusion?.items.join("\n") || t.notAvailable,
        `${item.confidencePercent}%`,
        item.verificationStatus,
        item.verifierExplanation ?? t.notAvailable,
        item.evidence.length,
      ].map(safeExcelText),
    );
    const aiColors = statusStyle(item.aiStatus);
    row.getCell(5).font = { name: "Aptos", size: 10, bold: true, color: { argb: aiColors.color } };
    row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: aiColors.fill } };
    const effectiveColors = statusStyle(item.status);
    row.getCell(6).font = {
      name: "Aptos",
      size: 10,
      bold: true,
      color: { argb: effectiveColors.color },
    };
    row.getCell(6).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: effectiveColors.fill },
    };
  }
  styleDataRows(sheet, 2);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

export async function buildAnalysisXlsx(data: AnalysisExportData): Promise<Uint8Array> {
  const locale = localeOf(data.locale);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Neura Labs UG (haftungsbeschränkt)";
  workbook.company = "Neura Labs UG (haftungsbeschränkt)";
  workbook.title = `${translations[locale].reportTitle} · ${data.frameworkSlug.toUpperCase()}`;
  workbook.subject = data.policy.displayName;
  workbook.created = data.completedAt ?? data.createdAt;
  workbook.modified = data.completedAt ?? data.createdAt;
  workbook.calcProperties.fullCalcOnLoad = false;

  addResults(workbook, data, locale);

  const buffer = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  return new Uint8Array(buffer);
}

export function createAnalysisExportFilename(
  data: Pick<AnalysisExportData, "frameworkSlug" | "id">,
) {
  const framework = data.frameworkSlug
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `gap-analyse-${framework || "rahmenwerk"}-${data.id.slice(0, 8)}.xlsx`;
}
