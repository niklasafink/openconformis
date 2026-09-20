CREATE TYPE "public"."review_cell_source" AS ENUM('jev', 'escalation_model');--> statement-breakpoint
CREATE TYPE "public"."review_cell_state" AS ENUM('queued', 'routing', 'deciding', 'escalated', 'complete', 'needs_review', 'failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."review_citation_verdict" AS ENUM('verified', 'contradicted', 'unsupported', 'fabricated');--> statement-breakpoint
CREATE TYPE "public"."review_column_type" AS ENUM('noul', 'choice', 'score');--> statement-breakpoint
CREATE TYPE "public"."review_decision_engine" AS ENUM('jev', 'model');--> statement-breakpoint
CREATE TYPE "public"."review_evidence_support" AS ENUM('supports', 'contradicts', 'context');--> statement-breakpoint
CREATE TYPE "public"."review_invocation_status" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_run_stage" AS ENUM('queued', 'preparing', 'routing', 'deciding', 'verifying', 'finalizing');--> statement-breakpoint
CREATE TYPE "public"."review_run_status" AS ENUM('queued', 'running', 'completed', 'completed_with_gaps', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "review_cell_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cell_id" uuid NOT NULL,
	"document_block_id" uuid NOT NULL,
	"citation_order" integer NOT NULL,
	"support" "review_evidence_support" NOT NULL,
	"exact_quote" text NOT NULL,
	"block_text_hash" text NOT NULL,
	"page_number" integer,
	"paragraph_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_cell_evidence_content_check" CHECK ("review_cell_evidence"."citation_order" > 0 AND length(btrim("review_cell_evidence"."exact_quote")) > 0)
);
--> statement-breakpoint
CREATE TABLE "review_cell_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cell_id" uuid NOT NULL,
	"answer_boolean" boolean,
	"answer_choice" text,
	"answer_score_bp" integer,
	"reason" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_cell_overrides_reason_length_check" CHECK (length(btrim("review_cell_overrides"."reason")) between 8 and 2000),
	CONSTRAINT "review_cell_overrides_answer_shape_check" CHECK (num_nonnulls("review_cell_overrides"."answer_boolean", "review_cell_overrides"."answer_choice", "review_cell_overrides"."answer_score_bp") = 1)
);
--> statement-breakpoint
CREATE TABLE "review_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_run_id" uuid NOT NULL,
	"run_document_id" uuid NOT NULL,
	"run_column_id" uuid NOT NULL,
	"state" "review_cell_state" DEFAULT 'queued' NOT NULL,
	"source" "review_cell_source",
	"answer_boolean" boolean,
	"answer_choice" text,
	"answer_score_bp" integer,
	"probability_bp" integer,
	"confidence_bp" integer,
	"distribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rationale" text,
	"citation_verdict" "review_citation_verdict",
	"decision_model_id" text,
	"input_hash" text,
	"output_hash" text,
	"failure_code" text,
	"confirmed_by_user_id" text,
	"confirmed_at" timestamp with time zone,
	"change_seq" bigserial NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_cells_answer_shape_check" CHECK (CASE
          WHEN "review_cells"."state" IN ('complete', 'needs_review')
            THEN num_nonnulls("review_cells"."answer_boolean", "review_cells"."answer_choice", "review_cells"."answer_score_bp") = 1
              AND "review_cells"."source" IS NOT NULL
              AND length(btrim(coalesce("review_cells"."rationale", ''))) > 0
          ELSE num_nonnulls("review_cells"."answer_boolean", "review_cells"."answer_choice", "review_cells"."answer_score_bp") = 0
        END),
	CONSTRAINT "review_cells_measure_check" CHECK (("review_cells"."probability_bp" IS NULL OR "review_cells"."probability_bp" BETWEEN 0 AND 10000)
        AND ("review_cells"."confidence_bp" IS NULL OR "review_cells"."confidence_bp" BETWEEN 0 AND 10000)
        AND ("review_cells"."answer_score_bp" IS NULL OR "review_cells"."answer_score_bp" BETWEEN 0 AND 10000)
        AND "review_cells"."revision" > 0
        AND ("review_cells"."state" <> 'failed' OR "review_cells"."failure_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "review_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_table_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"column_type" "review_column_type" NOT NULL,
	"instructions" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_columns_content_check" CHECK (length(btrim("review_columns"."label")) between 1 and 120
        AND length(btrim("review_columns"."instructions")) between 8 and 4000
        AND "review_columns"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "review_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_table_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_evidence_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_run_id" uuid NOT NULL,
	"cell_id" uuid NOT NULL,
	"state_token_count" integer NOT NULL,
	"budget_token_count" integer NOT NULL,
	"empty_reason" text,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_evidence_packets_hash_check" CHECK ("review_evidence_packets"."input_hash" ~ '^[0-9a-f]{64}$'
        AND "review_evidence_packets"."output_hash" ~ '^[0-9a-f]{64}$'
        AND "review_evidence_packets"."state_token_count" >= 0
        AND "review_evidence_packets"."state_token_count" <= "review_evidence_packets"."budget_token_count")
);
--> statement-breakpoint
CREATE TABLE "review_model_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_run_id" uuid NOT NULL,
	"run_document_id" uuid,
	"cell_id" uuid,
	"phase" text NOT NULL,
	"batch_key" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"question_count" integer DEFAULT 1 NOT NULL,
	"status" "review_invocation_status" DEFAULT 'started' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_microunits" integer,
	"latency_milliseconds" integer,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "review_model_invocations_batch_key_check" CHECK ("review_model_invocations"."batch_key" ~ '^[0-9a-f]{64}$' AND "review_model_invocations"."question_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "review_run_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_run_id" uuid NOT NULL,
	"review_column_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"column_type" "review_column_type" NOT NULL,
	"instructions" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_run_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_run_id" uuid NOT NULL,
	"review_document_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"display_name" text NOT NULL,
	"policy_sha256" text,
	"policy_parser_version" text,
	"child_workflow_run_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_table_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"workflow_run_id" text,
	"status" "review_run_status" DEFAULT 'queued' NOT NULL,
	"stage" "review_run_stage" DEFAULT 'queued' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"completed_cell_count" integer DEFAULT 0 NOT NULL,
	"total_cell_count" integer NOT NULL,
	"escalated_cell_count" integer DEFAULT 0 NOT NULL,
	"failed_cell_count" integer DEFAULT 0 NOT NULL,
	"decision_engine" "review_decision_engine" NOT NULL,
	"document_set_hash" text NOT NULL,
	"column_set_hash" text NOT NULL,
	"configuration_hash" text NOT NULL,
	"routing_provider" text NOT NULL,
	"jev_model_id" text,
	"escalation_provider" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"model_profile_id" text NOT NULL,
	"model_catalogue_version" text NOT NULL,
	"privacy_profile_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"escalation_threshold_bp" integer NOT NULL,
	"citation_accept_threshold_bp" integer NOT NULL,
	"escalation_budget_cells" integer NOT NULL,
	"state_token_budget" integer NOT NULL,
	"routing_credential_id" uuid,
	"escalation_credential_id" uuid,
	"credential_deadline_at" timestamp with time zone,
	"failure_code" text,
	"failure_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_runs_budget_check" CHECK ("review_runs"."state_token_budget" BETWEEN 1024 AND 32000
        AND "review_runs"."escalation_threshold_bp" BETWEEN 0 AND 10000
        AND "review_runs"."citation_accept_threshold_bp" BETWEEN 0 AND 10000
        AND "review_runs"."escalation_budget_cells" >= 0
        AND "review_runs"."total_cell_count" >= 0
        AND "review_runs"."progress_percent" BETWEEN 0 AND 100),
	CONSTRAINT "review_runs_engine_route_check" CHECK ((
          "review_runs"."decision_engine" = 'jev'
          AND "review_runs"."routing_provider" = 'typesafe'
          AND "review_runs"."jev_model_id" IS NOT NULL
        ) OR (
          "review_runs"."decision_engine" = 'model'
          AND "review_runs"."routing_provider" <> 'typesafe'
          AND "review_runs"."jev_model_id" IS NULL
        )),
	CONSTRAINT "review_runs_escalation_route_check" CHECK ("review_runs"."escalation_provider" <> 'typesafe'),
	CONSTRAINT "review_runs_credential_pair_check" CHECK ((
          "review_runs"."routing_credential_id" IS NULL AND "review_runs"."escalation_credential_id" IS NULL
        ) OR (
          "review_runs"."routing_credential_id" IS NOT NULL
          AND "review_runs"."escalation_credential_id" IS NOT NULL
          AND "review_runs"."routing_credential_id" <> "review_runs"."escalation_credential_id"
        ))
);
--> statement-breakpoint
CREATE TABLE "review_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"locale" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_tables_name_check" CHECK (length(btrim("review_tables"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "review_cell_evidence" ADD CONSTRAINT "review_cell_evidence_cell_id_review_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."review_cells"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cell_evidence" ADD CONSTRAINT "review_cell_evidence_document_block_id_document_blocks_id_fk" FOREIGN KEY ("document_block_id") REFERENCES "public"."document_blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cell_overrides" ADD CONSTRAINT "review_cell_overrides_cell_id_review_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."review_cells"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cell_overrides" ADD CONSTRAINT "review_cell_overrides_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cells" ADD CONSTRAINT "review_cells_review_run_id_review_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cells" ADD CONSTRAINT "review_cells_run_document_id_review_run_documents_id_fk" FOREIGN KEY ("run_document_id") REFERENCES "public"."review_run_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cells" ADD CONSTRAINT "review_cells_run_column_id_review_run_columns_id_fk" FOREIGN KEY ("run_column_id") REFERENCES "public"."review_run_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cells" ADD CONSTRAINT "review_cells_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_columns" ADD CONSTRAINT "review_columns_review_table_id_review_tables_id_fk" FOREIGN KEY ("review_table_id") REFERENCES "public"."review_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_documents" ADD CONSTRAINT "review_documents_review_table_id_review_tables_id_fk" FOREIGN KEY ("review_table_id") REFERENCES "public"."review_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_documents" ADD CONSTRAINT "review_documents_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_evidence_packets" ADD CONSTRAINT "review_evidence_packets_review_run_id_review_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_evidence_packets" ADD CONSTRAINT "review_evidence_packets_cell_id_review_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."review_cells"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_model_invocations" ADD CONSTRAINT "review_model_invocations_review_run_id_review_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_model_invocations" ADD CONSTRAINT "review_model_invocations_run_document_id_review_run_documents_id_fk" FOREIGN KEY ("run_document_id") REFERENCES "public"."review_run_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_model_invocations" ADD CONSTRAINT "review_model_invocations_cell_id_review_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."review_cells"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run_columns" ADD CONSTRAINT "review_run_columns_review_run_id_review_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run_columns" ADD CONSTRAINT "review_run_columns_review_column_id_review_columns_id_fk" FOREIGN KEY ("review_column_id") REFERENCES "public"."review_columns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run_documents" ADD CONSTRAINT "review_run_documents_review_run_id_review_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run_documents" ADD CONSTRAINT "review_run_documents_review_document_id_review_documents_id_fk" FOREIGN KEY ("review_document_id") REFERENCES "public"."review_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run_documents" ADD CONSTRAINT "review_run_documents_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_review_table_id_review_tables_id_fk" FOREIGN KEY ("review_table_id") REFERENCES "public"."review_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_routing_credential_id_ai_credentials_id_fk" FOREIGN KEY ("routing_credential_id") REFERENCES "public"."ai_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_escalation_credential_id_ai_credentials_id_fk" FOREIGN KEY ("escalation_credential_id") REFERENCES "public"."ai_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tables" ADD CONSTRAINT "review_tables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tables" ADD CONSTRAINT "review_tables_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_cell_evidence_cell_order_uidx" ON "review_cell_evidence" USING btree ("cell_id","citation_order");--> statement-breakpoint
CREATE INDEX "review_cell_evidence_cell_idx" ON "review_cell_evidence" USING btree ("cell_id");--> statement-breakpoint
CREATE INDEX "review_cell_evidence_block_idx" ON "review_cell_evidence" USING btree ("document_block_id");--> statement-breakpoint
CREATE INDEX "review_cell_overrides_cell_created_idx" ON "review_cell_overrides" USING btree ("cell_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_cells_document_column_uidx" ON "review_cells" USING btree ("run_document_id","run_column_id");--> statement-breakpoint
CREATE INDEX "review_cells_run_change_seq_idx" ON "review_cells" USING btree ("review_run_id","change_seq");--> statement-breakpoint
CREATE INDEX "review_cells_run_state_idx" ON "review_cells" USING btree ("review_run_id","state");--> statement-breakpoint
CREATE INDEX "review_cells_run_updated_at_idx" ON "review_cells" USING btree ("review_run_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_columns_table_ordinal_uidx" ON "review_columns" USING btree ("review_table_id","ordinal") WHERE "review_columns"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "review_columns_table_idx" ON "review_columns" USING btree ("review_table_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "review_documents_table_version_uidx" ON "review_documents" USING btree ("review_table_id","policy_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_documents_table_ordinal_uidx" ON "review_documents" USING btree ("review_table_id","ordinal");--> statement-breakpoint
CREATE INDEX "review_documents_version_idx" ON "review_documents" USING btree ("policy_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_evidence_packets_cell_uidx" ON "review_evidence_packets" USING btree ("cell_id");--> statement-breakpoint
CREATE INDEX "review_evidence_packets_run_idx" ON "review_evidence_packets" USING btree ("review_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_model_invocations_batch_uidx" ON "review_model_invocations" USING btree ("review_run_id","batch_key");--> statement-breakpoint
CREATE INDEX "review_model_invocations_run_provider_idx" ON "review_model_invocations" USING btree ("review_run_id","provider");--> statement-breakpoint
CREATE INDEX "review_model_invocations_run_started_idx" ON "review_model_invocations" USING btree ("review_run_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_run_columns_run_column_uidx" ON "review_run_columns" USING btree ("review_run_id","review_column_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_run_columns_run_ordinal_uidx" ON "review_run_columns" USING btree ("review_run_id","ordinal");--> statement-breakpoint
CREATE INDEX "review_run_columns_run_idx" ON "review_run_columns" USING btree ("review_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_run_documents_run_document_uidx" ON "review_run_documents" USING btree ("review_run_id","review_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_run_documents_run_ordinal_uidx" ON "review_run_documents" USING btree ("review_run_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "review_run_documents_child_run_uidx" ON "review_run_documents" USING btree ("child_workflow_run_id") WHERE "review_run_documents"."child_workflow_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "review_run_documents_run_idx" ON "review_run_documents" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "review_runs_table_created_at_idx" ON "review_runs" USING btree ("review_table_id","created_at");--> statement-breakpoint
CREATE INDEX "review_runs_status_created_at_idx" ON "review_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "review_runs_owner_created_at_idx" ON "review_runs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_runs_workflow_run_uidx" ON "review_runs" USING btree ("workflow_run_id") WHERE "review_runs"."workflow_run_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_runs_routing_credential_uidx" ON "review_runs" USING btree ("routing_credential_id") WHERE "review_runs"."routing_credential_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_runs_escalation_credential_uidx" ON "review_runs" USING btree ("escalation_credential_id") WHERE "review_runs"."escalation_credential_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "review_tables_organization_created_at_idx" ON "review_tables" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "review_tables_owner_created_at_idx" ON "review_tables" USING btree ("owner_user_id","created_at");