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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { analysisResultStatus, evidenceSupport } from "./analyses";
import { organizations, users } from "./auth";
import { disclosureReviewStatus, disclosureRuns } from "./disclosure";
import { documentBlocks } from "./documents";

/**
 * Vollständigkeitsprüfung der Offenlegungspflicht (Etappe 9): ein Prüfungsbericht gegen
 * eine Checkliste von Angabepflichten. Zwei Ebenen:
 *
 * - **Vorlagen** sind versionierte Stammdaten wie Rahmenwerke. Nur
 *   Catalogue-Administratoren legen sie an — per Excel-Import als neue Version oder per
 *   Demo-Seed. Ein Import ist zuerst ein Entwurf mit Vorschau und wird dann veröffentlicht.
 * - **Eigene Checklisten** gehören einer Organisation, entstehen nur als Kopie einer
 *   veröffentlichten Vorlage und sind bearbeitbar.
 *
 * Ein Lauf kopiert die verwendeten Positionen als Schnappschuss; spätere Änderungen an
 * Vorlage oder eigener Checkliste erreichen ihn nicht. Ergebnisse, Belege und Overrides
 * folgen dem Muster von `analyses.ts`, die Freigabe dem der Feststellungen (D-034).
 */

export const disclosureChecklistReleaseStatus = pgEnum("disclosure_checklist_release_status", [
  "draft",
  "published",
  "archived",
]);

export const disclosureChecklistSourceKind = pgEnum("disclosure_checklist_source_kind", [
  "seed",
  "excel_import",
]);

/** `demo` für den mitgelieferten Seed; `operator` für Vorlagen des Betreibers. */
export const disclosureChecklistClassification = pgEnum("disclosure_checklist_classification", [
  "demo",
  "operator",
]);

export const disclosureChecklistTemplates = pgTable(
  "disclosure_checklist_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Stabiler Schlüssel; ein Import mit demselben Schlüssel wird eine neue Version. */
    key: text("key").notNull(),
    title: text("title").notNull(),
    classification: disclosureChecklistClassification("classification").notNull(),
    provenanceNote: text("provenance_note").notNull(),
    reuseNotice: text("reuse_notice").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_checklist_templates_key_uidx").on(table.key),
    check(
      "disclosure_checklist_templates_key_check",
      sql`${table.key} ~ '^[a-z0-9][a-z0-9-]{1,79}$'`,
    ),
    check(
      "disclosure_checklist_templates_title_check",
      sql`length(btrim(${table.title})) between 1 and 200`,
    ),
  ],
);

export const disclosureChecklistTemplateReleases = pgTable(
  "disclosure_checklist_template_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => disclosureChecklistTemplates.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: disclosureChecklistReleaseStatus("status").default("draft").notNull(),
    sourceKind: disclosureChecklistSourceKind("source_kind").notNull(),
    sourceFilename: text("source_filename"),
    contentHash: text("content_hash").notNull(),
    itemCount: integer("item_count").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedByUserId: text("published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_checklist_template_releases_version_uidx").on(
      table.templateId,
      table.version,
    ),
    index("disclosure_checklist_template_releases_status_idx").on(table.status),
    check("disclosure_checklist_template_releases_version_check", sql`${table.version} > 0`),
    check(
      "disclosure_checklist_template_releases_published_check",
      sql`${table.status} = 'draft' OR ${table.publishedAt} IS NOT NULL`,
    ),
    check(
      "disclosure_checklist_template_releases_items_check",
      sql`${table.itemCount} between 1 and 500`,
    ),
  ],
);

export const disclosureChecklistTemplateItems = pgTable(
  "disclosure_checklist_template_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => disclosureChecklistTemplateReleases.id, { onDelete: "cascade" }),
    externalKey: text("external_key").notNull(),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    requirement: text("requirement").notNull(),
    aspects: text("aspects")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    parentItemId: uuid("parent_item_id").references(
      (): AnyPgColumn => disclosureChecklistTemplateItems.id,
      { onDelete: "cascade" },
    ),
    displayOrder: integer("display_order").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_checklist_template_items_key_uidx").on(
      table.releaseId,
      table.externalKey,
    ),
    index("disclosure_checklist_template_items_order_idx").on(table.releaseId, table.displayOrder),
  ],
);

/** Eine eigene Checkliste der Organisation, immer eine Kopie einer Vorlagenversion. */
export const disclosureChecklists = pgTable(
  "disclosure_checklists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    templateReleaseId: uuid("template_release_id")
      .notNull()
      .references(() => disclosureChecklistTemplateReleases.id, { onDelete: "restrict" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("disclosure_checklists_organization_idx").on(table.organizationId, table.updatedAt),
    check(
      "disclosure_checklists_title_check",
      sql`length(btrim(${table.title})) between 1 and 200`,
    ),
  ],
);

export const disclosureChecklistItems = pgTable(
  "disclosure_checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => disclosureChecklists.id, { onDelete: "cascade" }),
    externalKey: text("external_key").notNull(),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    requirement: text("requirement").notNull(),
    aspects: text("aspects")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    parentItemId: uuid("parent_item_id").references(
      (): AnyPgColumn => disclosureChecklistItems.id,
      { onDelete: "set null" },
    ),
    displayOrder: integer("display_order").notNull(),
    contentHash: text("content_hash").notNull(),
    /** Die Vorlagenposition, aus der die Position kopiert wurde; neue Positionen haben keine. */
    originTemplateItemId: uuid("origin_template_item_id").references(
      () => disclosureChecklistTemplateItems.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("disclosure_checklist_items_key_uidx").on(table.checklistId, table.externalKey),
    index("disclosure_checklist_items_order_idx").on(table.checklistId, table.displayOrder),
    check(
      "disclosure_checklist_items_text_check",
      sql`length(btrim(${table.title})) between 1 and 300 AND length(btrim(${table.requirement})) between 1 and 6000 AND length(btrim(${table.reference})) between 1 and 200`,
    ),
  ],
);

/**
 * Die Positionen eines Laufs, beim Start kopiert. Herkunft steht je Position; die
 * Hierarchie über Schlüssel, damit der Schnappschuss ohne Fremdschlüssel auskommt.
 */
export const disclosureRunChecklistItems = pgTable(
  "disclosure_run_checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => disclosureRuns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    externalKey: text("external_key").notNull(),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    requirement: text("requirement").notNull(),
    aspects: text("aspects")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    parentKey: text("parent_key"),
    depth: integer("depth").default(0).notNull(),
    contentHash: text("content_hash").notNull(),
    templateReleaseId: uuid("template_release_id"),
    checklistId: uuid("checklist_id"),
    sourceItemId: uuid("source_item_id"),
  },
  (table) => [
    uniqueIndex("disclosure_run_checklist_items_ordinal_uidx").on(table.runId, table.ordinal),
    uniqueIndex("disclosure_run_checklist_items_key_uidx").on(table.runId, table.externalKey),
    check(
      "disclosure_run_checklist_items_origin_check",
      sql`(${table.templateReleaseId} IS NOT NULL) <> (${table.checklistId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Bewertung einer Position: Status, Begründung und Konfidenz wie in der Gap-Analyse,
 * dazu die Freigabefelder des Vier-Augen-Prinzips. `(run_item_id)` ist eindeutig und
 * damit der Idempotenzschlüssel jeder Wiederholung.
 */
export const disclosureCompletenessResults = pgTable(
  "disclosure_completeness_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => disclosureRuns.id, { onDelete: "cascade" }),
    runItemId: uuid("run_item_id")
      .notNull()
      .references(() => disclosureRunChecklistItems.id, { onDelete: "cascade" }),
    status: analysisResultStatus("status").notNull(),
    explanation: text("explanation").notNull(),
    missingInformation: text("missing_information")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    confidenceBasisPoints: integer("confidence_basis_points").notNull(),
    /** Das Modell wurde nicht gefragt: keine Belegstelle im Bericht gefunden. */
    modelId: text("model_id"),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
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
    uniqueIndex("disclosure_completeness_results_item_uidx").on(table.runItemId),
    index("disclosure_completeness_results_run_idx").on(table.runId, table.status),
    check(
      "disclosure_completeness_results_explanation_check",
      sql`length(btrim(${table.explanation})) between 1 and 6000`,
    ),
    check(
      "disclosure_completeness_results_confidence_check",
      sql`${table.confidenceBasisPoints} between 0 and 10000`,
    ),
    check(
      "disclosure_completeness_results_four_eyes_check",
      sql`${table.reviewedByUserId} IS NULL OR ${table.preparedByUserId} IS NULL OR ${table.reviewedByUserId} <> ${table.preparedByUserId}`,
    ),
  ],
);

/** Ein belegtes Zitat: exakter Ausschnitt eines unveränderlichen Dokumentblocks. */
export const disclosureCompletenessEvidence = pgTable(
  "disclosure_completeness_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => disclosureCompletenessResults.id, { onDelete: "cascade" }),
    citationOrder: integer("citation_order").notNull(),
    documentBlockId: uuid("document_block_id")
      .notNull()
      .references(() => documentBlocks.id, { onDelete: "restrict" }),
    support: evidenceSupport("support").notNull(),
    exactQuote: text("exact_quote").notNull(),
    blockTextHash: text("block_text_hash").notNull(),
    pageNumber: integer("page_number"),
    paragraphNumber: integer("paragraph_number"),
  },
  (table) => [
    uniqueIndex("disclosure_completeness_evidence_order_uidx").on(
      table.resultId,
      table.citationOrder,
    ),
    check("disclosure_completeness_evidence_order_check", sql`${table.citationOrder} > 0`),
  ],
);

/**
 * Ein begründeter Override des Status durch den Prüfer. Höchstens einer je Ergebnis ist
 * aktiv; ein neuer ersetzt ihn, der alte bleibt mit `superseded_at` stehen.
 */
export const disclosureCompletenessOverrides = pgTable(
  "disclosure_completeness_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => disclosureCompletenessResults.id, { onDelete: "cascade" }),
    status: analysisResultStatus("status").notNull(),
    reason: text("reason").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("disclosure_completeness_overrides_active_uidx")
      .on(table.resultId)
      .where(sql`${table.supersededAt} IS NULL`),
    check(
      "disclosure_completeness_overrides_reason_check",
      sql`length(btrim(${table.reason})) between 8 and 2000`,
    ),
  ],
);

export const disclosureCompletenessEventKind = pgEnum("disclosure_completeness_event_kind", [
  "comment",
  "confirmed",
  "overridden",
  "released",
  "rejected",
]);

/** Der Verlauf einer Position, nur anfügend. `rejected` ändert keinen Status. */
export const disclosureCompletenessEvents = pgTable(
  "disclosure_completeness_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => disclosureCompletenessResults.id, { onDelete: "cascade" }),
    kind: disclosureCompletenessEventKind("kind").notNull(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body"),
    overrideId: uuid("override_id").references(() => disclosureCompletenessOverrides.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("disclosure_completeness_events_result_idx").on(table.resultId, table.createdAt),
    check(
      "disclosure_completeness_events_body_check",
      sql`${table.body} IS NULL OR length(${table.body}) BETWEEN 1 AND 2000`,
    ),
  ],
);

/** Eine @Erwähnung in einem Ereignis; ohne Benachrichtigung. */
export const disclosureCompletenessMentions = pgTable(
  "disclosure_completeness_mentions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => disclosureCompletenessEvents.id, { onDelete: "cascade" }),
    mentionedUserId: text("mentioned_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("disclosure_completeness_mentions_event_user_uidx").on(
      table.eventId,
      table.mentionedUserId,
    ),
  ],
);
