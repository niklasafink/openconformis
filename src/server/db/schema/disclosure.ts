import { sql } from "drizzle-orm";
import {
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
import { policyVersions } from "./documents";

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
