import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
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
