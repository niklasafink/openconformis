import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations, users } from "./auth";
import { documentBlocks, policyVersions } from "./documents";

/**
 * Der Bereich Offenlegungspflicht: ein Prüfungsbericht (nur DOCX) mit Belegen wie der
 * SuSa, geprüft im Plausicheck (Zahlen) und in der Vollständigkeitsprüfung
 * (Checkliste). Vollständig additiv wie die Vertragsprüfung: keine bestehende Tabelle
 * ändert sich. Ein Bericht ist technisch eine `policy_version`, Upload, Parsing und
 * `document_blocks` bleiben unverändert.
 */

export const disclosureCaseStatus = pgEnum("disclosure_case_status", ["active", "archived"]);

export const disclosureDocumentRole = pgEnum("disclosure_document_role", [
  "report",
  /** Vorjahresbericht: die Rolle existiert, eine Prüfung dagegen noch nicht. */
  "prior_report",
  "evidence",
]);

/** Stand der deterministischen Erkennung (Zahlen, Richtungswörter, Tabellen) je Bericht. */
export const disclosureRecognitionStatus = pgEnum("disclosure_recognition_status", [
  "pending",
  "running",
  "ready",
  "failed",
]);

export const disclosureFigureUnit = pgEnum("disclosure_figure_unit", [
  "EUR",
  "percent",
  "count",
  "unknown",
]);

export const disclosurePeriodHint = pgEnum("disclosure_period_hint", ["current", "prior", "other"]);

export const disclosureDirection = pgEnum("disclosure_direction", ["up", "down", "flat"]);

export const disclosureCases = pgTable(
  "disclosure_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    status: disclosureCaseStatus("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("disclosure_cases_organization_updated_idx").on(table.organizationId, table.updatedAt),
    check("disclosure_cases_title_check", sql`length(btrim(${table.title})) between 1 and 200`),
  ],
);

/**
 * Ein Dokument einer Prüfung; `ordinal` ist die Reihenfolge der Dokument-Reiter.
 * Der Bericht ist eine `policy_version`, ein Beleg eine eigene Belegdatei — genau
 * eines von beiden ist gesetzt.
 */
export const disclosureCaseDocuments = pgTable(
  "disclosure_case_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => disclosureCases.id, { onDelete: "cascade" }),
    role: disclosureDocumentRole("role").notNull(),
    policyVersionId: uuid("policy_version_id").references(() => policyVersions.id, {
      onDelete: "restrict",
    }),
    evidenceFileId: uuid("evidence_file_id"),
    ordinal: integer("ordinal").notNull(),
    displayName: text("display_name").notNull(),
    recognitionStatus: disclosureRecognitionStatus("recognition_status")
      .default("pending")
      .notNull(),
    recognitionVersion: text("recognition_version"),
    recognitionWorkflowRunId: text("recognition_workflow_run_id"),
    recognitionErrorCode: text("recognition_error_code"),
    recognizedAt: timestamp("recognized_at", { withTimezone: true }),
    /** Berichtsjahr aus dem Dokument, um „(2024: …)“ als Vorjahr zu lesen. */
    reportYear: integer("report_year"),
    /** Die Tabellenstruktur konnte aus dem Original gelesen werden (vor dessen Löschung). */
    tableStructure: boolean("table_structure").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_case_documents_case_ordinal_uidx").on(table.caseId, table.ordinal),
    uniqueIndex("disclosure_case_documents_case_version_uidx")
      .on(table.caseId, table.policyVersionId)
      .where(sql`${table.policyVersionId} IS NOT NULL`),
    uniqueIndex("disclosure_case_documents_one_report_uidx")
      .on(table.caseId)
      .where(sql`${table.role} = 'report'`),
    index("disclosure_case_documents_version_idx").on(table.policyVersionId),
    check(
      "disclosure_case_documents_source_check",
      sql`(${table.policyVersionId} IS NOT NULL) <> (${table.evidenceFileId} IS NOT NULL)
        AND (${table.role} <> 'evidence' OR ${table.evidenceFileId} IS NOT NULL)
        AND (${table.role} = 'evidence' OR ${table.policyVersionId} IS NOT NULL)`,
    ),
    check(
      "disclosure_case_documents_name_check",
      sql`length(btrim(${table.displayName})) between 1 and 255`,
    ),
  ],
);

/**
 * Kontext eines unveränderlichen Dokumentblocks für den Plausicheck: PDF-Seite aus
 * dem Marker des Konverters, Textziffer, Tabellenlage und Spaltenkopf. Die Blöcke
 * selbst bleiben unberührt.
 */
export const disclosureBlockContext = pgTable(
  "disclosure_block_context",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseDocumentId: uuid("case_document_id")
      .notNull()
      .references(() => disclosureCaseDocuments.id, { onDelete: "cascade" }),
    documentBlockId: uuid("document_block_id")
      .notNull()
      .references(() => documentBlocks.id, { onDelete: "restrict" }),
    pageNumber: integer("page_number"),
    tz: text("tz"),
    tableIndex: integer("table_index"),
    rowIndex: integer("row_index"),
    columnIndex: integer("column_index"),
    isHeader: boolean("is_header").default(false).notNull(),
    rowLabel: text("row_label"),
    columnLabel: text("column_label"),
    tableCaption: text("table_caption"),
    /** Der Block ist kein Berichtsinhalt (Seitenmarker, OCR-Vermerk). */
    technical: boolean("technical").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_block_context_block_uidx").on(
      table.caseDocumentId,
      table.documentBlockId,
    ),
    index("disclosure_block_context_table_idx").on(
      table.caseDocumentId,
      table.tableIndex,
      table.rowIndex,
    ),
  ],
);

/**
 * Eine erkannte Zahl. Der Wert ist exakt (`bigint`, Millionstel der Grundeinheit);
 * `display_unit_micro` ist die kleinste dargestellte Einheit für die Rundungsregel.
 */
export const disclosureFigures = pgTable(
  "disclosure_figures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseDocumentId: uuid("case_document_id")
      .notNull()
      .references(() => disclosureCaseDocuments.id, { onDelete: "cascade" }),
    documentBlockId: uuid("document_block_id")
      .notNull()
      .references(() => documentBlocks.id, { onDelete: "restrict" }),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    rawText: text("raw_text").notNull(),
    valueMicro: bigint("value_micro", { mode: "bigint" }),
    scale: integer("scale").notNull(),
    unit: disclosureFigureUnit("unit").notNull(),
    displayUnitMicro: bigint("display_unit_micro", { mode: "bigint" }).notNull(),
    decimals: integer("decimals").notNull(),
    periodHint: disclosurePeriodHint("period_hint"),
    parseIssue: text("parse_issue"),
    parenthesized: boolean("parenthesized").default(false).notNull(),
    rowLabel: text("row_label"),
    extractionVersion: text("extraction_version").notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_figures_block_offset_uidx").on(
      table.caseDocumentId,
      table.documentBlockId,
      table.startOffset,
    ),
    index("disclosure_figures_case_document_idx").on(table.caseDocumentId),
    check(
      "disclosure_figures_offsets_check",
      sql`${table.startOffset} >= 0 AND ${table.endOffset} > ${table.startOffset}`,
    ),
  ],
);

/** Ein erkanntes Richtungswort („stieg“, „verringerte sich“, „unverändert“). */
export const disclosureStatements = pgTable(
  "disclosure_statements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseDocumentId: uuid("case_document_id")
      .notNull()
      .references(() => disclosureCaseDocuments.id, { onDelete: "cascade" }),
    documentBlockId: uuid("document_block_id")
      .notNull()
      .references(() => documentBlocks.id, { onDelete: "restrict" }),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    rawText: text("raw_text").notNull(),
    direction: disclosureDirection("direction").notNull(),
    extractionVersion: text("extraction_version").notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_statements_block_offset_uidx").on(
      table.caseDocumentId,
      table.documentBlockId,
      table.startOffset,
    ),
    index("disclosure_statements_case_document_idx").on(table.caseDocumentId),
  ],
);

/** Stand einer Belegdatei vom Upload bis zu den gelesenen Konten. */
export const disclosureEvidenceStatus = pgEnum("disclosure_evidence_status", [
  "awaiting_upload",
  "uploaded",
  "parsing",
  "ready",
  "failed",
]);

/**
 * Eine Belegdatei einer Prüfung, derzeit nur die Summen- und Saldenliste als `.xlsx`.
 * Sie trägt ihre eigene Upload-Absicht (Pfad, erklärte Größe, Frist); nach dem Lesen
 * wird das Original gelöscht, die Konten bleiben.
 */
export const disclosureEvidenceFiles = pgTable(
  "disclosure_evidence_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => disclosureCases.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").default("susa_xlsx").notNull(),
    filename: text("filename").notNull(),
    objectKey: text("object_key").notNull(),
    declaredByteSize: integer("declared_byte_size").notNull(),
    sha256: text("sha256"),
    status: disclosureEvidenceStatus("status").default("awaiting_upload").notNull(),
    parserVersion: text("parser_version"),
    errorCode: text("error_code"),
    accountCount: integer("account_count").default(0).notNull(),
    uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
    deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
    originalDeletedAt: timestamp("original_deleted_at", { withTimezone: true }),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_evidence_files_object_uidx").on(table.objectKey),
    index("disclosure_evidence_files_case_idx").on(table.caseId, table.createdAt),
    check("disclosure_evidence_files_kind_check", sql`${table.kind} = 'susa_xlsx'`),
    check(
      "disclosure_evidence_files_filename_check",
      sql`length(btrim(${table.filename})) between 1 and 255`,
    ),
    check(
      "disclosure_evidence_files_size_check",
      sql`${table.declaredByteSize} between 1 and 10485760`,
    ),
  ],
);

/** Ein Konto der SuSa; Beträge exakt in Millionstel EUR wie die erkannten Zahlen. */
export const disclosureEvidenceAccounts = pgTable(
  "disclosure_evidence_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceFileId: uuid("evidence_file_id")
      .notNull()
      .references(() => disclosureEvidenceFiles.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    accountNumber: text("account_number").notNull(),
    label: text("label").notNull(),
    openingMicro: bigint("opening_micro", { mode: "bigint" }),
    debitMicro: bigint("debit_micro", { mode: "bigint" }),
    creditMicro: bigint("credit_micro", { mode: "bigint" }),
    closingMicro: bigint("closing_micro", { mode: "bigint" }).notNull(),
    /** Posten des Code-Katalogs aus der Bezeichnung; `null` heißt nicht zugeordnet. */
    postenKey: text("posten_key"),
  },
  (table) => [
    uniqueIndex("disclosure_evidence_accounts_row_uidx").on(table.evidenceFileId, table.rowNumber),
    check(
      "disclosure_evidence_accounts_number_check",
      sql`${table.accountNumber} ~ '^[0-9]{3,9}$'`,
    ),
  ],
);

/*
 * Plausicheck-Läufe (Etappe 4). Ein Lauf friert Bericht, Erkennungs- und Prüfversion
 * ein; Modellroute, Prompt-Version und Schlüssel sind nullable und werden erst mit der
 * Einordnung über das Nutzermodell (Etappe 5) bzw. Jev (Etappe 6) gesetzt.
 */

export const disclosureRunKind = pgEnum("disclosure_run_kind", ["plausibility", "completeness"]);

export const disclosureRunStatus = pgEnum("disclosure_run_status", [
  "queued",
  "running",
  "completed",
  "completed_with_gaps",
  "failed",
  "cancelled",
]);

export const disclosureCheckKind = pgEnum("disclosure_check_kind", [
  "sentence_arithmetic",
  "direction",
  "table_sum",
  "balance",
  "horizontal_sum",
  "change_column",
  "cross_reference",
  "prior_year",
  "derived",
  "ratio",
  "evidence",
]);

export const disclosureCheckStatus = pgEnum("disclosure_check_status", [
  "match",
  "mismatch",
  "uncertain",
]);

export const disclosureCheckSourceKind = pgEnum("disclosure_check_source_kind", [
  "table",
  "text",
  "formula",
  "evidence",
]);

export const disclosureAssignmentSource = pgEnum("disclosure_assignment_source", [
  "rule",
  "jev",
  "model",
]);

export const disclosureReviewStatus = pgEnum("disclosure_review_status", [
  "open",
  "prepared",
  "reviewed",
]);

export const disclosureInvocationProvider = pgEnum("disclosure_invocation_provider", [
  "model",
  "jev",
]);

export const disclosureInvocationStatus = pgEnum("disclosure_invocation_status", [
  "started",
  "succeeded",
  "failed",
]);

/**
 * Die Einordnung durch Jev, wie der Start sie eingefroren hat: der wirksame Wert.
 * Ohne gespeicherten TypeSafe-Schlüssel steht hier `off`, auch wenn die Umgebung `on`
 * verlangt — der Nachweis behauptet nichts, was nicht geschah.
 */
export const disclosureJevAssist = pgEnum("disclosure_jev_assist", ["on", "off"]);

export const disclosureRuns = pgTable(
  "disclosure_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => disclosureCases.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: disclosureRunKind("kind").default("plausibility").notNull(),
    status: disclosureRunStatus("status").default("queued").notNull(),
    stage: text("stage").default("queued").notNull(),
    // Eingefrorene Eingaben.
    reportCaseDocumentId: uuid("report_case_document_id")
      .notNull()
      .references(() => disclosureCaseDocuments.id, { onDelete: "cascade" }),
    reportPolicyVersionId: uuid("report_policy_version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "restrict" }),
    reportSha256: text("report_sha256").notNull(),
    reportParserVersion: text("report_parser_version").notNull(),
    extractionVersion: text("extraction_version").notNull(),
    checkVersion: text("check_version").notNull(),
    configurationHash: text("configuration_hash").notNull(),
    /** Eingefrorene Belegdateien (SuSa), gelesen und bereit beim Start. */
    evidenceFileIds: uuid("evidence_file_ids")
      .array()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    // Einordnung über das Nutzermodell (Etappe 5) und Jev (Etappe 6).
    routeProvider: text("route_provider"),
    providerModelId: text("provider_model_id"),
    modelProfileId: text("model_profile_id"),
    modelCatalogueVersion: text("model_catalogue_version"),
    promptVersion: text("prompt_version"),
    aiCredentialId: uuid("ai_credential_id"),
    assistCredentialId: uuid("assist_credential_id"),
    jevAssist: disclosureJevAssist("jev_assist").default("off").notNull(),
    jevModelId: text("jev_model_id"),
    credentialDeadlineAt: timestamp("credential_deadline_at", { withTimezone: true }),
    workflowRunId: text("workflow_run_id"),
    // Zähler: `plannedCheckCount` steht nach den deterministischen Prüfungen fest.
    figureCount: integer("figure_count").default(0).notNull(),
    plannedCheckCount: integer("planned_check_count"),
    assignmentBatchCount: integer("assignment_batch_count").default(0).notNull(),
    failedBatchCount: integer("failed_batch_count").default(0).notNull(),
    mismatchCount: integer("mismatch_count").default(0).notNull(),
    uncertainCount: integer("uncertain_count").default(0).notNull(),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("disclosure_runs_case_created_idx").on(table.caseId, table.createdAt),
    uniqueIndex("disclosure_runs_workflow_run_uidx")
      .on(table.workflowRunId)
      .where(sql`${table.workflowRunId} IS NOT NULL`),
    // Höchstens ein offener Lauf je Prüfung und Art: die Idempotenz des Starts.
    uniqueIndex("disclosure_runs_one_open_uidx")
      .on(table.caseId, table.kind)
      .where(sql`${table.status} IN ('queued', 'running')`),
    check(
      "disclosure_runs_model_check",
      sql`(${table.routeProvider} IS NULL) = (${table.providerModelId} IS NULL)
        AND (${table.routeProvider} IS NULL OR ${table.promptVersion} IS NOT NULL)`,
    ),
    check("disclosure_runs_failure_detail_check", sql`length(${table.failureDetail}) <= 700`),
    check(
      "disclosure_runs_jev_frozen_check",
      sql`${table.jevAssist} = 'off' OR (${table.jevModelId} IS NOT NULL AND ${table.assistCredentialId} IS NOT NULL AND ${table.routeProvider} IS NOT NULL)`,
    ),
  ],
);

/**
 * Eine Prüfung: Ist gegen Soll mit Toleranz, Quelle und Kommentar aus einer Code-Vorlage.
 * `(run_id, kind, subject_key, source_key)` ist eindeutig und damit der
 * Idempotenzschlüssel jeder Wiederholung.
 */
export const disclosureChecks = pgTable(
  "disclosure_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => disclosureRuns.id, { onDelete: "cascade" }),
    kind: disclosureCheckKind("kind").notNull(),
    status: disclosureCheckStatus("status").notNull(),
    subjectKey: text("subject_key").notNull(),
    subjectFigureId: uuid("subject_figure_id").references(() => disclosureFigures.id, {
      onDelete: "cascade",
    }),
    statementId: uuid("statement_id").references(() => disclosureStatements.id, {
      onDelete: "cascade",
    }),
    actualMicro: bigint("actual_micro", { mode: "bigint" }),
    expectedMicro: bigint("expected_micro", { mode: "bigint" }),
    toleranceMicro: bigint("tolerance_micro", { mode: "bigint" }),
    rounded: boolean("rounded").default(false).notNull(),
    sourceKind: disclosureCheckSourceKind("source_kind").notNull(),
    sourceFigureIds: uuid("source_figure_ids")
      .array()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    sourceBlockIds: uuid("source_block_ids")
      .array()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    sourceAccountIds: uuid("source_account_ids")
      .array()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    sourceLabel: text("source_label").notNull(),
    /** Posten oder Zeile des Gegenstands, für den Titel einer Feststellung. */
    subjectLabel: text("subject_label"),
    commentCode: text("comment_code").notNull(),
    commentParams: jsonb("comment_params").$type<Record<string, string>>().default({}).notNull(),
    comment: text("comment").notNull(),
    sourceKey: text("source_key").notNull(),
    assignmentSource: disclosureAssignmentSource("assignment_source").default("rule").notNull(),
    confidenceBp: integer("confidence_bp"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_checks_run_subject_uidx").on(
      table.runId,
      table.kind,
      table.subjectKey,
      table.sourceKey,
    ),
    index("disclosure_checks_run_figure_idx").on(table.runId, table.subjectFigureId),
    check(
      "disclosure_checks_subject_check",
      sql`(${table.subjectFigureId} IS NOT NULL) <> (${table.statementId} IS NOT NULL)`,
    ),
    check("disclosure_checks_comment_check", sql`length(${table.comment}) BETWEEN 1 AND 160`),
    check(
      "disclosure_checks_confidence_check",
      sql`${table.confidenceBp} IS NULL OR ${table.confidenceBp} BETWEEN 0 AND 10000`,
    ),
  ],
);

/**
 * Eine Feststellung je roter oder oranger Marke; sie verweist auf die schlechteste
 * Prüfung und trägt die Freigabefelder des Vier-Augen-Prinzips (Etappe 8).
 */
export const disclosureFindings = pgTable(
  "disclosure_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => disclosureRuns.id, { onDelete: "cascade" }),
    checkId: uuid("check_id")
      .notNull()
      .references(() => disclosureChecks.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    title: text("title").notNull(),
    severity: disclosureCheckStatus("severity").notNull(),
    pageNumber: integer("page_number"),
    tz: text("tz"),
    reviewStatus: disclosureReviewStatus("review_status").default("open").notNull(),
    preparedByUserId: text("prepared_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_findings_run_check_uidx").on(table.runId, table.checkId),
    uniqueIndex("disclosure_findings_run_ordinal_uidx").on(table.runId, table.ordinal),
    check("disclosure_findings_title_check", sql`length(${table.title}) BETWEEN 1 AND 60`),
    check("disclosure_findings_severity_check", sql`${table.severity} <> 'match'`),
    check(
      "disclosure_findings_four_eyes_check",
      sql`${table.reviewedByUserId} IS NULL OR ${table.preparedByUserId} IS NULL OR ${table.reviewedByUserId} <> ${table.preparedByUserId}`,
    ),
  ],
);

/**
 * Ein bezahlter Aufruf zur Einordnung (Modell oder Jev). Die Antwort enthält nur IDs,
 * Posten-Keys, Perioden, Konfidenzen und einen kurzen Kommentar — nie Berichtstext oder
 * Schlüssel. `(run_id, batch_key)` ist eindeutig: eine Wiederholung liest die Antwort.
 */
export const disclosureModelInvocations = pgTable(
  "disclosure_model_invocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => disclosureRuns.id, { onDelete: "cascade" }),
    batchKey: text("batch_key").notNull(),
    provider: disclosureInvocationProvider("provider").notNull(),
    routeProvider: text("route_provider").notNull(),
    modelId: text("model_id").notNull(),
    itemCount: integer("item_count").notNull(),
    status: disclosureInvocationStatus("status").default("started").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costMicrounits: integer("cost_microunits"),
    latencyMilliseconds: integer("latency_milliseconds"),
    errorCode: text("error_code"),
    response: jsonb("response").$type<unknown>(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("disclosure_model_invocations_batch_uidx").on(table.runId, table.batchKey),
    check(
      "disclosure_model_invocations_batch_key_check",
      sql`${table.batchKey} ~ '^[0-9a-f]{64}$' AND ${table.itemCount} > 0`,
    ),
  ],
);
