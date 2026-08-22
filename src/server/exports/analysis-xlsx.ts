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
  organizationContext: string;
  locale: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  fundingMode: "sponsored" | "byok";
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
    evidence: Array<{
      citationOrder: number;
      support: "supports" | "contradicts" | "context";
      exactQuote: string;
      blockTextHash: string;
      pageNumber: number | null;
      paragraphNumber: number | null;
    }>;
  }>;
  overrideHistory: Array<{
    regulatoryId: string;
    status: ExportResultStatus;
    reason: string;
    actorUserId: string | null;
    createdAt: Date;
  }>;
  invocations: Array<{
    invocationStage: string;
    provider: string;
    modelId: string;
    providerRequestId: string | null;
    status: "started" | "succeeded" | "failed";
    cacheHit: boolean;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    costMicrounits: number | null;
    latencyMilliseconds: number | null;
    errorCode: string | null;
    startedAt: Date;
    completedAt: Date | null;
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
    overview: "Übersicht",
    results: "Ergebnisse",
    evidence: "Belegstellen",
    auditTrail: "Prüfpfad",
    modelCalls: "Modellaufrufe",
    reviewHistory: "Prüfhistorie",
    reportTitle: "Gap-Analyse",
    key: "Merkmal",
    value: "Wert",
    analysisId: "Analyse-ID",
    framework: "Rahmenwerk",
    release: "Release",
    policy: "Policy",
    policyVersion: "Policy-Version",
    pages: "Seiten",
    institutionSize: "Institutsgröße",
    created: "Erstellt",
    started: "Gestartet",
    completed: "Abgeschlossen",
    fundingMode: "Finanzierungsart",
    organizationContext: "Unternehmenskontext",
    statusSummary: "Statusübersicht",
    count: "Anzahl",
    regulatoryId: "Regulatorische ID",
    title: "Titel",
    requirement: "Anforderung",
    subrequirements: "Subanforderungen",
    status: "Status",
    aiStatus: "Ursprünglicher KI-Status",
    effectiveStatus: "Wirksamer Status",
    overrideReason: "Begründung der Änderung",
    overriddenAt: "Geändert am",
    reviewer: "Bearbeitet von",
    assessment: "Begründung der Bewertung",
    missingInformation: "Fehlende Informationen",
    confidence: "Konfidenz",
    verification: "Verifikation",
    verifierAssessment: "Begründung der Verifikation",
    evidenceCount: "Belegstellen",
    confirmed: "Menschlich bestätigt",
    confirmedBy: "Bestätigt von",
    confirmedAt: "Bestätigt am",
    sizeGuidance: "Größenleitlinie",
    assessmentAspects: "Prüfaspekte",
    source: "Quelle",
    citation: "Beleg",
    support: "Belegtyp",
    exactQuote: "Exaktes Zitat",
    page: "Seite",
    paragraph: "Absatz",
    blockHash: "Block-Hash",
    configuration: "Konfiguration",
    configurationHash: "Konfigurations-Hash",
    frameworkHash: "Rahmenwerk-Hash",
    policyHash: "Policy-Hash",
    parserVersion: "Parser-Version",
    routeProvider: "Providerroute",
    model: "Analysemodell",
    modelProfile: "Analysemodell-Profil",
    verifierModel: "Verifizierungsmodell",
    verifierProfile: "Verifizierungsprofil",
    modelCatalogue: "Modellkatalog-Version",
    privacyProfile: "Datenschutzprofil",
    promptVersion: "Analyseanweisung-Version",
    verifierPromptVersion: "Verifizierungsanweisung-Version",
    stage: "Stufe",
    provider: "Provider",
    providerRequestId: "Provider-Request-ID",
    cacheHit: "Cache-Treffer",
    inputTokens: "Input-Token",
    cachedTokens: "Gecachte Input-Token",
    outputTokens: "Output-Token",
    reasoningTokens: "Reasoning-Token",
    cost: "Kosten (USD)",
    latency: "Latenz (ms)",
    errorCode: "Fehlercode",
    no: "Nein",
    yes: "Ja",
    notAvailable: "–",
    statuses: {
      fulfilled: "Erfüllt",
      partially_fulfilled: "Teilweise erfüllt",
      not_fulfilled: "Nicht erfüllt",
      not_applicable: "Nicht einschlägig",
      no_assessment_possible: "Keine Einschätzung möglich",
    },
    institutionSizes: { small: "Klein", medium: "Mittel", large: "Groß" },
  },
  en: {
    overview: "Overview",
    results: "Results",
    evidence: "Evidence",
    auditTrail: "Audit trail",
    modelCalls: "Model calls",
    reviewHistory: "Review history",
    reportTitle: "Gap analysis",
    key: "Attribute",
    value: "Value",
    analysisId: "Analysis ID",
    framework: "Framework",
    release: "Release",
    policy: "Policy",
    policyVersion: "Policy version",
    pages: "Pages",
    institutionSize: "Institution size",
    created: "Created",
    started: "Started",
    completed: "Completed",
    fundingMode: "Funding mode",
    organizationContext: "Company context",
    statusSummary: "Status summary",
    count: "Count",
    regulatoryId: "Regulatory ID",
    title: "Title",
    requirement: "Requirement",
    subrequirements: "Subrequirements",
    status: "Status",
    aiStatus: "Original AI status",
    effectiveStatus: "Effective status",
    overrideReason: "Reason for change",
    overriddenAt: "Changed at",
    reviewer: "Reviewed by",
    assessment: "Assessment rationale",
    missingInformation: "Missing information",
    confidence: "Confidence",
    verification: "Verification",
    verifierAssessment: "Verification rationale",
    evidenceCount: "Evidence items",
    confirmed: "Human confirmed",
    confirmedBy: "Confirmed by",
    confirmedAt: "Confirmed at",
    sizeGuidance: "Size guidance",
    assessmentAspects: "Assessment aspects",
    source: "Source",
    citation: "Citation",
    support: "Evidence type",
    exactQuote: "Exact quote",
    page: "Page",
    paragraph: "Paragraph",
    blockHash: "Block hash",
    configuration: "Configuration",
    configurationHash: "Configuration hash",
    frameworkHash: "Framework hash",
    policyHash: "Policy hash",
    parserVersion: "Parser version",
    routeProvider: "Provider route",
    model: "Assessment model",
    modelProfile: "Assessment model profile",
    verifierModel: "Verification model",
    verifierProfile: "Verification profile",
    modelCatalogue: "Model catalogue version",
    privacyProfile: "Privacy profile",
    promptVersion: "Assessment instruction version",
    verifierPromptVersion: "Verification instruction version",
    stage: "Stage",
    provider: "Provider",
    providerRequestId: "Provider request ID",
    cacheHit: "Cache hit",
    inputTokens: "Input tokens",
    cachedTokens: "Cached input tokens",
    outputTokens: "Output tokens",
    reasoningTokens: "Reasoning tokens",
    cost: "Cost (USD)",
    latency: "Latency (ms)",
    errorCode: "Error code",
    no: "No",
    yes: "Yes",
    notAvailable: "–",
    statuses: {
      fulfilled: "Fulfilled",
      partially_fulfilled: "Partially fulfilled",
      not_fulfilled: "Not fulfilled",
      not_applicable: "Not applicable",
      no_assessment_possible: "No assessment possible",
    },
    institutionSizes: { small: "Small", medium: "Medium", large: "Large" },
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

function styleTitle(sheet: ExcelJS.Worksheet, title: string, lastColumn: number) {
  sheet.mergeCells(1, 1, 1, lastColumn);
  const cell = sheet.getCell(1, 1);
  cell.value = safeExcelText(title);
  cell.font = { name: "Aptos Display", size: 18, bold: true, color: { argb: palette.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.navy } };
  cell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 34;
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

function addOverview(workbook: ExcelJS.Workbook, data: AnalysisExportData, locale: ExportLocale) {
  const t = translations[locale];
  const sheet = workbook.addWorksheet(t.overview, {
    views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
  });
  sheet.columns = [{ width: 31 }, { width: 86 }];
  styleTitle(sheet, `${t.reportTitle} · ${data.frameworkSlug.toUpperCase()}`, 2);
  sheet.addRow([]);
  const header = sheet.addRow([t.key, t.value]);
  styleHeader(header);

  const rows: Array<[unknown, unknown]> = [
    [t.analysisId, data.id],
    [t.framework, data.frameworkSlug.toUpperCase()],
    [t.release, data.frameworkReleaseKey],
    [t.policy, data.policy.displayName],
    [t.policyVersion, data.policy.versionNumber],
    [t.pages, data.policy.pageCount ?? t.notAvailable],
    [t.institutionSize, t.institutionSizes[data.institutionSize]],
    [t.created, iso(data.createdAt, t.notAvailable)],
    [t.started, iso(data.startedAt, t.notAvailable)],
    [t.completed, iso(data.completedAt, t.notAvailable)],
    [t.fundingMode, data.fundingMode],
    [t.organizationContext, data.organizationContext || t.notAvailable],
  ];
  for (const row of rows) sheet.addRow(row.map(safeExcelText));

  sheet.addRow([]);
  const summaryHeading = sheet.addRow([t.statusSummary, t.count]);
  styleHeader(summaryHeading);
  const counts = new Map<ExportResultStatus, number>();
  for (const item of data.items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  for (const status of Object.keys(t.statuses) as ExportResultStatus[]) {
    const row = sheet.addRow([safeExcelText(t.statuses[status]), counts.get(status) ?? 0]);
    const colors = statusStyle(status);
    row.getCell(1).font = { name: "Aptos", size: 10, bold: true, color: { argb: colors.color } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.fill } };
  }
  styleDataRows(sheet, 4);
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function addResults(workbook: ExcelJS.Workbook, data: AnalysisExportData, locale: ExportLocale) {
  const t = translations[locale];
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
    { width: 44 },
    { width: 14 },
    { width: 22 },
    { width: 54 },
    { width: 14 },
    { width: 20 },
    { width: 24 },
    { width: 34 },
    { width: 48 },
    { width: 42 },
    { width: 34 },
  ];
  const headers = [
    t.regulatoryId,
    t.title,
    t.requirement,
    t.subrequirements,
    t.aiStatus,
    t.effectiveStatus,
    t.overrideReason,
    t.overriddenAt,
    t.reviewer,
    t.assessment,
    t.missingInformation,
    t.confidence,
    t.verification,
    t.verifierAssessment,
    t.evidenceCount,
    t.confirmed,
    t.confirmedAt,
    t.confirmedBy,
    t.sizeGuidance,
    t.assessmentAspects,
    t.source,
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
        item.missingInformation.join("\n"),
        `${item.confidencePercent}%`,
        item.verificationStatus,
        item.verifierExplanation ?? t.notAvailable,
        item.evidence.length,
        item.confirmedAt ? t.yes : t.no,
        iso(item.confirmedAt, t.notAvailable),
        item.confirmedByUserId ?? t.notAvailable,
        item.sizeGuidance,
        item.assessmentAspects.join("\n"),
        item.sourceLocator ?? t.notAvailable,
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

function addEvidence(workbook: ExcelJS.Workbook, data: AnalysisExportData, locale: ExportLocale) {
  const t = translations[locale];
  const sheet = workbook.addWorksheet(t.evidence, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  sheet.columns = [
    { width: 24 },
    { width: 34 },
    { width: 10 },
    { width: 18 },
    { width: 92 },
    { width: 11 },
    { width: 12 },
    { width: 68 },
  ];
  const headers = [
    t.regulatoryId,
    t.title,
    t.citation,
    t.support,
    t.exactQuote,
    t.page,
    t.paragraph,
    t.blockHash,
  ];
  styleHeader(sheet.addRow(headers.map(safeExcelText)));
  for (const item of data.items) {
    for (const evidence of item.evidence) {
      sheet.addRow(
        [
          item.regulatoryId,
          item.title,
          evidence.citationOrder,
          evidence.support,
          evidence.exactQuote,
          evidence.pageNumber ?? t.notAvailable,
          evidence.paragraphNumber ?? t.notAvailable,
          evidence.blockTextHash,
        ].map(safeExcelText),
      );
    }
  }
  styleDataRows(sheet, 2);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function addAuditTrail(workbook: ExcelJS.Workbook, data: AnalysisExportData, locale: ExportLocale) {
  const t = translations[locale];
  const sheet = workbook.addWorksheet(t.auditTrail, {
    views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
  });
  sheet.columns = [{ width: 40 }, { width: 96 }];
  styleTitle(sheet, t.auditTrail, 2);
  sheet.addRow([]);
  styleHeader(sheet.addRow([t.configuration, t.value]));
  const rows: Array<[unknown, unknown]> = [
    [t.configurationHash, data.configurationHash],
    [t.frameworkHash, data.frameworkContentHash],
    [t.policyHash, data.policySha256],
    [t.parserVersion, data.policyParserVersion],
    [t.routeProvider, data.routeProvider],
    [t.model, data.providerModelId],
    [t.modelProfile, data.modelProfileId],
    [t.verifierModel, data.verifierProviderModelId],
    [t.verifierProfile, data.verifierModelProfileId],
    [t.modelCatalogue, data.modelCatalogueVersion],
    [t.privacyProfile, data.privacyProfileId],
    [t.promptVersion, data.promptVersion],
    [t.verifierPromptVersion, data.verifierPromptVersion],
  ];
  for (const row of rows) sheet.addRow(row.map(safeExcelText));
  styleDataRows(sheet, 4);
}

function addReviewHistory(
  workbook: ExcelJS.Workbook,
  data: AnalysisExportData,
  locale: ExportLocale,
) {
  const t = translations[locale];
  const sheet = workbook.addWorksheet(t.reviewHistory, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  sheet.columns = [{ width: 26 }, { width: 25 }, { width: 82 }, { width: 36 }, { width: 26 }];
  const headers = [t.regulatoryId, t.effectiveStatus, t.overrideReason, t.reviewer, t.overriddenAt];
  styleHeader(sheet.addRow(headers.map(safeExcelText)));
  for (const entry of data.overrideHistory) {
    const row = sheet.addRow(
      [
        entry.regulatoryId,
        t.statuses[entry.status],
        entry.reason,
        entry.actorUserId ?? t.notAvailable,
        iso(entry.createdAt, t.notAvailable),
      ].map(safeExcelText),
    );
    const colors = statusStyle(entry.status);
    row.getCell(2).font = {
      name: "Aptos",
      size: 10,
      bold: true,
      color: { argb: colors.color },
    };
    row.getCell(2).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: colors.fill },
    };
  }
  styleDataRows(sheet, 2);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function addModelCalls(workbook: ExcelJS.Workbook, data: AnalysisExportData, locale: ExportLocale) {
  const t = translations[locale];
  const sheet = workbook.addWorksheet(t.modelCalls, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  sheet.columns = [
    { width: 22 },
    { width: 20 },
    { width: 42 },
    { width: 36 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 18 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 22 },
    { width: 26 },
    { width: 26 },
  ];
  const headers = [
    t.stage,
    t.provider,
    t.model,
    t.providerRequestId,
    t.status,
    t.cacheHit,
    t.inputTokens,
    t.cachedTokens,
    t.outputTokens,
    t.reasoningTokens,
    t.cost,
    t.latency,
    t.errorCode,
    t.started,
    t.completed,
  ];
  styleHeader(sheet.addRow(headers.map(safeExcelText)));
  for (const invocation of data.invocations) {
    sheet.addRow(
      [
        invocation.invocationStage,
        invocation.provider,
        invocation.modelId,
        invocation.providerRequestId ?? t.notAvailable,
        invocation.status,
        invocation.cacheHit ? t.yes : t.no,
        invocation.inputTokens ?? t.notAvailable,
        invocation.cachedInputTokens ?? t.notAvailable,
        invocation.outputTokens ?? t.notAvailable,
        invocation.reasoningTokens ?? t.notAvailable,
        invocation.costMicrounits === null ? t.notAvailable : invocation.costMicrounits / 1_000_000,
        invocation.latencyMilliseconds ?? t.notAvailable,
        invocation.errorCode ?? t.notAvailable,
        iso(invocation.startedAt, t.notAvailable),
        iso(invocation.completedAt, t.notAvailable),
      ].map(safeExcelText),
    );
  }
  styleDataRows(sheet, 2);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
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

  addOverview(workbook, data, locale);
  addResults(workbook, data, locale);
  addEvidence(workbook, data, locale);
  addAuditTrail(workbook, data, locale);
  addReviewHistory(workbook, data, locale);
  addModelCalls(workbook, data, locale);

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
