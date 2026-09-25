import { relations, sql } from "drizzle-orm";
import {
  bigserial,
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

import type { SystemOneAnswer } from "@/domain/ai/system-one";
import type { ReviewColumnCriteria } from "@/domain/review/column";

import { aiCredentials } from "./ai";
import { organizations, users } from "./auth";
import { documentBlocks, policyVersions } from "./documents";

/**
 * Die Vertragsprüfung: *n* Verträge × *m* Entscheidungsspalten als Raster, jede Zelle
 * eine getypte Antwort mit exaktem Beleg (docs/DECISIONS.md D-030).
 *
 * Bewusst eng an `analyses.ts` gebaut und vollständig additiv: keine Spalte an
 * `analyses`, `policies` oder `document_blocks` ändert sich. Ein `git revert` der
 * Jev-Commits lässt eine funktionierende Anwendung zurück.
 */

export const reviewRunStatus = pgEnum("review_run_status", [
  "queued",
  "running",
  "completed",
  /**
   * Bei tausend Zellen darf eine dauerhaft scheiternde Zelle nicht 999 gute
   * Antworten verwerfen. Ein Lauf mit Lücken ist ein eigenes Ergebnis, kein Fehler.
   */
  "completed_with_gaps",
  "failed",
  "cancelled",
]);

export const reviewRunStage = pgEnum("review_run_stage", [
  "queued",
  "preparing",
  "routing",
  "deciding",
  "verifying",
  "finalizing",
]);

export const reviewColumnType = pgEnum("review_column_type", ["noul", "choice", "score"]);

export const reviewCellState = pgEnum("review_cell_state", [
  "queued",
  "routing",
  "deciding",
  "escalated",
  "complete",
  "needs_review",
  "failed",
  /** Der Kind-Lauf ist gestorben, ohne die Zelle zu beenden. Terminal wie `failed`. */
  "abandoned",
]);

export const reviewCellSource = pgEnum("review_cell_source", ["jev", "escalation_model"]);

export const reviewCitationVerdict = pgEnum("review_citation_verdict", [
  "verified",
  "contradicted",
  "unsupported",
  "fabricated",
]);

export const reviewEvidenceSupport = pgEnum("review_evidence_support", [
  "supports",
  "contradicts",
  "context",
]);

/**
 * Der Rückweg ohne Jev. Auf `model` läuft dasselbe Raster vollständig über das große
 * BYOK-Modell; der Modus wird je Lauf eingefroren, damit alte Ergebnisse lesbar
 * bleiben, statt im Nachhinein die Herkunft ihrer Antworten zu wechseln.
 */
export const reviewDecisionEngine = pgEnum("review_decision_engine", ["jev", "model"]);

export const reviewInvocationStatus = pgEnum("review_invocation_status", [
  "started",
  "succeeded",
  "failed",
]);

/** Ein Block, den das Belegrouting für diese Zelle ausgewählt hat. */
export type ReviewEvidenceCandidate = {
  blockKey: string;
  documentBlockId: string;
  relevanceBasisPoints: number;
  usableBasisPoints: number;
  injectionBasisPoints: number;
  tokenCount: number;
};

export const reviewTables = pgTable(
  "review_tables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    locale: text("locale").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * „Ergebnisse leeren": Läufe davor zeigt das Raster nicht mehr. Sie bleiben samt
     * Zellen, Belegen und Overrides für Audit und Export erhalten.
     */
    resultsClearedAt: timestamp("results_cleared_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("review_tables_organization_created_at_idx").on(table.organizationId, table.createdAt),
    index("review_tables_owner_created_at_idx").on(table.ownerUserId, table.createdAt),
    check("review_tables_name_check", sql`length(btrim(${table.name})) between 1 and 200`),
  ],
);

/**
 * Ein Vertrag im Raster. Technisch ist er eine `policy_version`, dadurch fallen
 * Upload, OCR, Parsing und `document_blocks` unverändert an.
 */
export const reviewDocuments = pgTable(
  "review_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewTableId: uuid("review_table_id")
      .notNull()
      .references(() => reviewTables.id, { onDelete: "cascade" }),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("review_documents_table_version_uidx").on(
      table.reviewTableId,
      table.policyVersionId,
    ),
    uniqueIndex("review_documents_table_ordinal_uidx").on(table.reviewTableId, table.ordinal),
    index("review_documents_version_idx").on(table.policyVersionId),
  ],
);

/**
 * Eine Entscheidungsspalte. `instructions` und `criteria` sind englisch, weil
 * TypeSafe Deutsch ausdrücklich schwächer nennt; die Beschriftung in der Oberfläche
 * bleibt davon unberührt zweisprachig.
 */
export const reviewColumns = pgTable(
  "review_columns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewTableId: uuid("review_table_id")
      .notNull()
      .references(() => reviewTables.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    label: text("label").notNull(),
    columnType: reviewColumnType("column_type").notNull(),
    instructions: text("instructions").notNull(),
    criteria: jsonb("criteria").$type<ReviewColumnCriteria>().notNull(),
    contentHash: text("content_hash").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("review_columns_table_ordinal_uidx")
      .on(table.reviewTableId, table.ordinal)
      .where(sql`${table.archivedAt} IS NULL`),
    index("review_columns_table_idx").on(table.reviewTableId, table.ordinal),
    check(
      "review_columns_content_check",
      sql`length(btrim(${table.label})) between 1 and 120
        AND length(btrim(${table.instructions})) between 8 and 4000
        AND ${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/**
 * Der Lauf mit eingefrorener Konfiguration, nach dem Vorbild von `analyses`.
 * Wiederholungen dürfen keine zweite Prüfung desselben Zustands erzeugen.
 */
export const reviewRuns = pgTable(
  "review_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewTableId: uuid("review_table_id")
      .notNull()
      .references(() => reviewTables.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    workflowRunId: text("workflow_run_id"),
    status: reviewRunStatus("status").default("queued").notNull(),
    stage: reviewRunStage("stage").default("queued").notNull(),
    progressPercent: integer("progress_percent").default(0).notNull(),
    /** Inkrementell fortgeschrieben, nicht bei jedem Ergebnis neu gezählt. */
    completedCellCount: integer("completed_cell_count").default(0).notNull(),
    totalCellCount: integer("total_cell_count").notNull(),
    escalatedCellCount: integer("escalated_cell_count").default(0).notNull(),
    failedCellCount: integer("failed_cell_count").default(0).notNull(),

    decisionEngine: reviewDecisionEngine("decision_engine").notNull(),
    documentSetHash: text("document_set_hash").notNull(),
    columnSetHash: text("column_set_hash").notNull(),
    configurationHash: text("configuration_hash").notNull(),

    /** Belegrouting und Zellentscheidung. Im Modus `model` ist das die BYOK-Route. */
    routingProvider: text("routing_provider").notNull(),
    jevModelId: text("jev_model_id"),
    /** Das grosse Modell für Eskalation und für den ganzen Lauf im Modus `model`. */
    escalationProvider: text("escalation_provider").notNull(),
    providerModelId: text("provider_model_id").notNull(),
    modelProfileId: text("model_profile_id").notNull(),
    modelCatalogueVersion: text("model_catalogue_version").notNull(),
    privacyProfileId: text("privacy_profile_id").notNull(),
    promptVersion: text("prompt_version").notNull(),

    /** Unter dieser Konfidenz eskaliert eine Zelle an das grosse Modell. */
    escalationThresholdBp: integer("escalation_threshold_bp").notNull(),
    /** Ab dieser Konfidenz gilt ein Zitat ohne Zweitmeinung als gestützt. */
    citationAcceptThresholdBp: integer("citation_accept_threshold_bp").notNull(),
    /**
     * Harte Deckelung der Eskalation. Darüber bleiben Zellen bei ihrer Jev-Antwort
     * mit gesetztem Prüfbedarf, statt weiter Geld auszugeben — die Konfidenzschwelle
     * ist der Kostenhebel, nicht Jev.
     */
    escalationBudgetCells: integer("escalation_budget_cells").notNull(),
    stateTokenBudget: integer("state_token_budget").notNull(),

    routingCredentialId: uuid("routing_credential_id").references(() => aiCredentials.id, {
      onDelete: "restrict",
    }),
    escalationCredentialId: uuid("escalation_credential_id").references(() => aiCredentials.id, {
      onDelete: "restrict",
    }),
    /**
     * Kleinste Schlüssel-Ablaufzeit minus fünf Minuten. Ohne sie wiederholte ein Lauf
     * mit abgelaufenem Schlüssel endlos, statt zu enden.
     */
    credentialDeadlineAt: timestamp("credential_deadline_at", { withTimezone: true }),

    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("review_runs_table_created_at_idx").on(table.reviewTableId, table.createdAt),
    index("review_runs_status_created_at_idx").on(table.status, table.createdAt),
    index("review_runs_owner_created_at_idx").on(table.ownerUserId, table.createdAt),
    uniqueIndex("review_runs_workflow_run_uidx")
      .on(table.workflowRunId)
      .where(sql`${table.workflowRunId} IS NOT NULL`),
    // Ein Schlüssel gehört genau einem Lauf — dieselbe Regel wie
    // `analyses_ai_credential_uidx`, je Zweck einmal.
    uniqueIndex("review_runs_routing_credential_uidx")
      .on(table.routingCredentialId)
      .where(sql`${table.routingCredentialId} IS NOT NULL`),
    uniqueIndex("review_runs_escalation_credential_uidx")
      .on(table.escalationCredentialId)
      .where(sql`${table.escalationCredentialId} IS NOT NULL`),
    check(
      "review_runs_budget_check",
      sql`${table.stateTokenBudget} BETWEEN 1024 AND 32000
        AND ${table.escalationThresholdBp} BETWEEN 0 AND 10000
        AND ${table.citationAcceptThresholdBp} BETWEEN 0 AND 10000
        AND ${table.escalationBudgetCells} >= 0
        AND ${table.totalCellCount} >= 0
        AND ${table.progressPercent} BETWEEN 0 AND 100`,
    ),
    /**
     * Die Eskalation darf nie wieder bei Jev landen — sonst prüfte derselbe Dienst
     * seine eigene unsichere Antwort. Im Modus `model` kommt TypeSafe gar nicht vor.
     */
    check(
      "review_runs_engine_route_check",
      sql`(
          ${table.decisionEngine} = 'jev'
          AND ${table.routingProvider} = 'typesafe'
          AND ${table.jevModelId} IS NOT NULL
        ) OR (
          ${table.decisionEngine} = 'model'
          AND ${table.routingProvider} <> 'typesafe'
          AND ${table.jevModelId} IS NULL
        )`,
    ),
    check("review_runs_escalation_route_check", sql`${table.escalationProvider} <> 'typesafe'`),
    check(
      "review_runs_credential_pair_check",
      sql`(
          ${table.routingCredentialId} IS NULL AND ${table.escalationCredentialId} IS NULL
        ) OR (
          ${table.routingCredentialId} IS NOT NULL
          AND ${table.escalationCredentialId} IS NOT NULL
          AND ${table.routingCredentialId} <> ${table.escalationCredentialId}
        )`,
    ),
  ],
);

/** Dokument-Schnappschuss und Cursor des Laufs. */
export const reviewRunDocuments = pgTable(
  "review_run_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewRunId: uuid("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    reviewDocumentId: uuid("review_document_id")
      .notNull()
      .references(() => reviewDocuments.id, { onDelete: "restrict" }),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    displayName: text("display_name").notNull(),
    policySha256: text("policy_sha256"),
    policyParserVersion: text("policy_parser_version"),
    /**
     * Der eigene Lauf dieses Vertrags. Der Eltern-Lauf setzt ihn bedingt vor
     * `start()`; ein zweites Kind erkennt daran, dass es still enden soll.
     */
    childWorkflowRunId: text("child_workflow_run_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("review_run_documents_run_document_uidx").on(
      table.reviewRunId,
      table.reviewDocumentId,
    ),
    uniqueIndex("review_run_documents_run_ordinal_uidx").on(table.reviewRunId, table.ordinal),
    uniqueIndex("review_run_documents_child_run_uidx")
      .on(table.childWorkflowRunId)
      .where(sql`${table.childWorkflowRunId} IS NOT NULL`),
    index("review_run_documents_run_idx").on(table.reviewRunId),
  ],
);

/** Spalten-Schnappschuss des Laufs; die Spalte selbst darf danach weiterleben. */
export const reviewRunColumns = pgTable(
  "review_run_columns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewRunId: uuid("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    reviewColumnId: uuid("review_column_id")
      .notNull()
      .references(() => reviewColumns.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    label: text("label").notNull(),
    columnType: reviewColumnType("column_type").notNull(),
    instructions: text("instructions").notNull(),
    criteria: jsonb("criteria").$type<ReviewColumnCriteria>().notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("review_run_columns_run_column_uidx").on(table.reviewRunId, table.reviewColumnId),
    uniqueIndex("review_run_columns_run_ordinal_uidx").on(table.reviewRunId, table.ordinal),
    index("review_run_columns_run_idx").on(table.reviewRunId),
  ],
);

/**
 * Die Zelle. `(runDocumentId, runColumnId)` ist der Idempotenzschlüssel des ganzen
 * Laufs — dasselbe Mittel wie `analysis_requirement_results_scope_item_uidx`. Ein
 * wiederholter Schritt findet die Zelle vor und arbeitet sie nicht erneut ab.
 */
export const reviewCells = pgTable(
  "review_cells",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewRunId: uuid("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    runDocumentId: uuid("run_document_id")
      .notNull()
      .references(() => reviewRunDocuments.id, { onDelete: "cascade" }),
    runColumnId: uuid("run_column_id")
      .notNull()
      .references(() => reviewRunColumns.id, { onDelete: "cascade" }),
    state: reviewCellState("state").default("queued").notNull(),
    source: reviewCellSource("source"),

    /** Genau eine dieser drei Spalten trägt die Antwort einer entschiedenen Zelle. */
    answerBoolean: boolean("answer_boolean"),
    answerChoice: text("answer_choice"),
    answerScoreBp: integer("answer_score_bp"),

    /** Wahrscheinlichkeit der gewählten Antwort und Konfidenz, beide in Basispunkten. */
    probabilityBp: integer("probability_bp"),
    confidenceBp: integer("confidence_bp"),
    distribution: jsonb("distribution")
      .$type<Record<string, number>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),

    /**
     * Zusammengesetzt aus Kriterium, belegten Textstellen und Wahrscheinlichkeit —
     * nicht erzeugt, wenn `source = 'jev'`. Nur eine eskalierte Zelle trägt eine vom
     * grossen Modell geschriebene Begründung.
     */
    rationale: text("rationale"),
    citationVerdict: reviewCitationVerdict("citation_verdict"),
    decisionModelId: text("decision_model_id"),
    inputHash: text("input_hash"),
    outputHash: text("output_hash"),
    failureCode: text("failure_code"),

    confirmedByUserId: text("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    /**
     * Monoton je Tabelle, getragen vom Index `(reviewRunId, changeSeq)`. Das Raster
     * holt darüber nur die veränderten Zellen statt tausend Zeilen je Runde.
     */
    changeSeq: bigserial("change_seq", { mode: "number" }).notNull(),
    /**
     * Monoton je Zelle. `bigserial` ist nur bei der Vergabe monoton, nicht beim
     * Commit; der Client verwirft über `revision` eine veraltete Lieferung.
     */
    revision: integer("revision").default(1).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("review_cells_document_column_uidx").on(table.runDocumentId, table.runColumnId),
    index("review_cells_run_change_seq_idx").on(table.reviewRunId, table.changeSeq),
    index("review_cells_run_state_idx").on(table.reviewRunId, table.state),
    index("review_cells_run_updated_at_idx").on(table.reviewRunId, table.updatedAt),
    /**
     * Eine entschiedene Zelle trägt **genau eine** getypte Antwort, nie zwei, nie
     * keine. Eine offene oder gescheiterte Zelle trägt keine.
     */
    check(
      "review_cells_answer_shape_check",
      sql`CASE
          WHEN ${table.state} IN ('complete', 'needs_review')
            THEN num_nonnulls(${table.answerBoolean}, ${table.answerChoice}, ${table.answerScoreBp}) = 1
              AND ${table.source} IS NOT NULL
              AND length(btrim(coalesce(${table.rationale}, ''))) > 0
          ELSE num_nonnulls(${table.answerBoolean}, ${table.answerChoice}, ${table.answerScoreBp}) = 0
        END`,
    ),
    check(
      "review_cells_measure_check",
      sql`(${table.probabilityBp} IS NULL OR ${table.probabilityBp} BETWEEN 0 AND 10000)
        AND (${table.confidenceBp} IS NULL OR ${table.confidenceBp} BETWEEN 0 AND 10000)
        AND (${table.answerScoreBp} IS NULL OR ${table.answerScoreBp} BETWEEN 0 AND 10000)
        AND ${table.revision} > 0
        AND (${table.state} <> 'failed' OR ${table.failureCode} IS NOT NULL)`,
    ),
  ],
);

/**
 * Die nummerierten Belege einer Zelle. Die Nummer ist dieselbe in Begründung,
 * Belegliste und Originaldokument.
 */
/**
 * `bigserial` vergibt nur beim **Einfügen**. Jede Änderung an einer Zelle muss die
 * Nummer ausdrücklich weiterdrehen, sonst holt das Live-Raster die Zelle nie wieder
 * ab und der Fortschritt bliebe stehen, obwohl der Lauf arbeitet.
 */
export const nextCellChangeSeq = sql`nextval(pg_get_serial_sequence('review_cells', 'change_seq'))`;

export const reviewCellEvidence = pgTable(
  "review_cell_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cellId: uuid("cell_id")
      .notNull()
      .references(() => reviewCells.id, { onDelete: "cascade" }),
    documentBlockId: uuid("document_block_id")
      .notNull()
      .references(() => documentBlocks.id, { onDelete: "restrict" }),
    citationOrder: integer("citation_order").notNull(),
    support: reviewEvidenceSupport("support").notNull(),
    /** Exakter Substring eines unveränderlichen Dokumentblocks. */
    exactQuote: text("exact_quote").notNull(),
    blockTextHash: text("block_text_hash").notNull(),
    pageNumber: integer("page_number"),
    paragraphNumber: integer("paragraph_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("review_cell_evidence_cell_order_uidx").on(table.cellId, table.citationOrder),
    index("review_cell_evidence_cell_idx").on(table.cellId),
    index("review_cell_evidence_block_idx").on(table.documentBlockId),
    check(
      "review_cell_evidence_content_check",
      sql`${table.citationOrder} > 0 AND length(btrim(${table.exactQuote})) > 0`,
    ),
  ],
);

/** Begründetes Überschreiben durch einen Menschen. Die KI entscheidet nicht endgültig. */
export const reviewCellOverrides = pgTable(
  "review_cell_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cellId: uuid("cell_id")
      .notNull()
      .references(() => reviewCells.id, { onDelete: "cascade" }),
    answerBoolean: boolean("answer_boolean"),
    answerChoice: text("answer_choice"),
    answerScoreBp: integer("answer_score_bp"),
    reason: text("reason").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("review_cell_overrides_cell_created_idx").on(table.cellId, table.createdAt),
    check(
      "review_cell_overrides_reason_length_check",
      sql`length(btrim(${table.reason})) between 8 and 2000`,
    ),
    check(
      "review_cell_overrides_answer_shape_check",
      sql`num_nonnulls(${table.answerBoolean}, ${table.answerChoice}, ${table.answerScoreBp}) = 1`,
    ),
  ],
);

/**
 * Die vom Belegrouting gewählten Blöcke je Zelle, samt der Routing-Werte. Das ist,
 * was der Screenshot „32k-aware evidence routing" nennt, als nachprüfbarer Datensatz.
 */
export const reviewEvidencePackets = pgTable(
  "review_evidence_packets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewRunId: uuid("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    cellId: uuid("cell_id")
      .notNull()
      .references(() => reviewCells.id, { onDelete: "cascade" }),
    stateTokenCount: integer("state_token_count").notNull(),
    budgetTokenCount: integer("budget_token_count").notNull(),
    /** Ausdrückliche Leermeldung statt eines abgeschnittenen Zitats. */
    emptyReason: text("empty_reason"),
    candidates: jsonb("candidates")
      .$type<ReviewEvidenceCandidate[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("review_evidence_packets_cell_uidx").on(table.cellId),
    index("review_evidence_packets_run_idx").on(table.reviewRunId),
    check(
      "review_evidence_packets_hash_check",
      sql`${table.inputHash} ~ '^[0-9a-f]{64}$'
        AND ${table.outputHash} ~ '^[0-9a-f]{64}$'
        AND ${table.stateTokenCount} >= 0
        AND ${table.stateTokenCount} <= ${table.budgetTokenCount}`,
    ),
  ],
);

/**
 * Telemetrie je Aufruf, Jev **und** grosses Modell. Ohne sie ist bei tausend Zellen
 * keine Kostenaussage möglich.
 *
 * `batchKey` wird deterministisch aus Inhalt und Phase gehasht, **nicht** aus der
 * Step-ID: sonst griffe die Sperre über einen Workflow-Neustart hinweg nicht und
 * jeder Step-Retry bezahlte denselben Jev-Request erneut.
 */
export const reviewModelInvocations = pgTable(
  "review_model_invocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewRunId: uuid("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    runDocumentId: uuid("run_document_id").references(() => reviewRunDocuments.id, {
      onDelete: "cascade",
    }),
    cellId: uuid("cell_id").references(() => reviewCells.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    batchKey: text("batch_key").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    questionCount: integer("question_count").default(1).notNull(),
    status: reviewInvocationStatus("status").default("started").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costMicrounits: integer("cost_microunits"),
    latencyMilliseconds: integer("latency_milliseconds"),
    errorCode: text("error_code"),
    /**
     * Die Antworten dieses Aufrufs, nur Zahlen und Optionsschlüssel — Jev gibt nie Text
     * zurück und enthält hier weder Vertragstext noch Schlüssel. Ohne sie wäre ein
     * bezahlter Aufruf nach einem Absturz zwischen Antwort und Speichern verloren: der
     * Step-Retry fände `succeeded`, hätte aber keine Antwort und müsste erneut zahlen.
     */
    response: jsonb("response").$type<Record<string, SystemOneAnswer>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("review_model_invocations_batch_uidx").on(table.reviewRunId, table.batchKey),
    index("review_model_invocations_run_provider_idx").on(table.reviewRunId, table.provider),
    index("review_model_invocations_run_started_idx").on(table.reviewRunId, table.startedAt),
    check(
      "review_model_invocations_batch_key_check",
      sql`${table.batchKey} ~ '^[0-9a-f]{64}$' AND ${table.questionCount} > 0`,
    ),
  ],
);

export const reviewTableRelations = relations(reviewTables, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [reviewTables.organizationId],
    references: [organizations.id],
  }),
  owner: one(users, { fields: [reviewTables.ownerUserId], references: [users.id] }),
  documents: many(reviewDocuments),
  columns: many(reviewColumns),
  runs: many(reviewRuns),
}));

export const reviewDocumentRelations = relations(reviewDocuments, ({ one }) => ({
  reviewTable: one(reviewTables, {
    fields: [reviewDocuments.reviewTableId],
    references: [reviewTables.id],
  }),
  policyVersion: one(policyVersions, {
    fields: [reviewDocuments.policyVersionId],
    references: [policyVersions.id],
  }),
}));

export const reviewColumnRelations = relations(reviewColumns, ({ one }) => ({
  reviewTable: one(reviewTables, {
    fields: [reviewColumns.reviewTableId],
    references: [reviewTables.id],
  }),
}));

export const reviewRunRelations = relations(reviewRuns, ({ one, many }) => ({
  reviewTable: one(reviewTables, {
    fields: [reviewRuns.reviewTableId],
    references: [reviewTables.id],
  }),
  owner: one(users, { fields: [reviewRuns.ownerUserId], references: [users.id] }),
  runDocuments: many(reviewRunDocuments),
  runColumns: many(reviewRunColumns),
  cells: many(reviewCells),
  modelInvocations: many(reviewModelInvocations),
}));

export const reviewRunDocumentRelations = relations(reviewRunDocuments, ({ one, many }) => ({
  reviewRun: one(reviewRuns, {
    fields: [reviewRunDocuments.reviewRunId],
    references: [reviewRuns.id],
  }),
  reviewDocument: one(reviewDocuments, {
    fields: [reviewRunDocuments.reviewDocumentId],
    references: [reviewDocuments.id],
  }),
  policyVersion: one(policyVersions, {
    fields: [reviewRunDocuments.policyVersionId],
    references: [policyVersions.id],
  }),
  cells: many(reviewCells),
}));

export const reviewRunColumnRelations = relations(reviewRunColumns, ({ one, many }) => ({
  reviewRun: one(reviewRuns, {
    fields: [reviewRunColumns.reviewRunId],
    references: [reviewRuns.id],
  }),
  reviewColumn: one(reviewColumns, {
    fields: [reviewRunColumns.reviewColumnId],
    references: [reviewColumns.id],
  }),
  cells: many(reviewCells),
}));

export const reviewCellRelations = relations(reviewCells, ({ one, many }) => ({
  reviewRun: one(reviewRuns, { fields: [reviewCells.reviewRunId], references: [reviewRuns.id] }),
  runDocument: one(reviewRunDocuments, {
    fields: [reviewCells.runDocumentId],
    references: [reviewRunDocuments.id],
  }),
  runColumn: one(reviewRunColumns, {
    fields: [reviewCells.runColumnId],
    references: [reviewRunColumns.id],
  }),
  evidence: many(reviewCellEvidence),
  overrides: many(reviewCellOverrides),
}));

export const reviewCellEvidenceRelations = relations(reviewCellEvidence, ({ one }) => ({
  cell: one(reviewCells, { fields: [reviewCellEvidence.cellId], references: [reviewCells.id] }),
  documentBlock: one(documentBlocks, {
    fields: [reviewCellEvidence.documentBlockId],
    references: [documentBlocks.id],
  }),
}));

export const reviewCellOverrideRelations = relations(reviewCellOverrides, ({ one }) => ({
  cell: one(reviewCells, { fields: [reviewCellOverrides.cellId], references: [reviewCells.id] }),
}));

export const reviewEvidencePacketRelations = relations(reviewEvidencePackets, ({ one }) => ({
  reviewRun: one(reviewRuns, {
    fields: [reviewEvidencePackets.reviewRunId],
    references: [reviewRuns.id],
  }),
  cell: one(reviewCells, { fields: [reviewEvidencePackets.cellId], references: [reviewCells.id] }),
}));

export const reviewModelInvocationRelations = relations(reviewModelInvocations, ({ one }) => ({
  reviewRun: one(reviewRuns, {
    fields: [reviewModelInvocations.reviewRunId],
    references: [reviewRuns.id],
  }),
}));
