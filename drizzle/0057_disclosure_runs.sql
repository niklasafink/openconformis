CREATE TYPE "public"."disclosure_assignment_source" AS ENUM('rule', 'jev', 'model');--> statement-breakpoint
CREATE TYPE "public"."disclosure_check_kind" AS ENUM('sentence_arithmetic', 'direction', 'table_sum', 'balance', 'horizontal_sum', 'change_column', 'cross_reference', 'prior_year', 'derived', 'ratio');--> statement-breakpoint
CREATE TYPE "public"."disclosure_check_source_kind" AS ENUM('table', 'text', 'formula', 'evidence');--> statement-breakpoint
CREATE TYPE "public"."disclosure_check_status" AS ENUM('match', 'mismatch', 'uncertain');--> statement-breakpoint
CREATE TYPE "public"."disclosure_invocation_provider" AS ENUM('model', 'jev');--> statement-breakpoint
CREATE TYPE "public"."disclosure_invocation_status" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."disclosure_review_status" AS ENUM('open', 'prepared', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."disclosure_run_kind" AS ENUM('plausibility', 'completeness');--> statement-breakpoint
CREATE TYPE "public"."disclosure_run_status" AS ENUM('queued', 'running', 'completed', 'completed_with_gaps', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "disclosure_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "disclosure_check_kind" NOT NULL,
	"status" "disclosure_check_status" NOT NULL,
	"subject_key" text NOT NULL,
	"subject_figure_id" uuid,
	"statement_id" uuid,
	"actual_micro" bigint,
	"expected_micro" bigint,
	"tolerance_micro" bigint,
	"rounded" boolean DEFAULT false NOT NULL,
	"source_kind" "disclosure_check_source_kind" NOT NULL,
	"source_figure_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"source_block_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"source_account_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"source_label" text NOT NULL,
	"subject_label" text,
	"comment_code" text NOT NULL,
	"comment_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comment" text NOT NULL,
	"source_key" text NOT NULL,
	"assignment_source" "disclosure_assignment_source" DEFAULT 'rule' NOT NULL,
	"confidence_bp" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_checks_subject_check" CHECK (("disclosure_checks"."subject_figure_id" IS NOT NULL) <> ("disclosure_checks"."statement_id" IS NOT NULL)),
	CONSTRAINT "disclosure_checks_comment_check" CHECK (length("disclosure_checks"."comment") BETWEEN 1 AND 160),
	CONSTRAINT "disclosure_checks_confidence_check" CHECK ("disclosure_checks"."confidence_bp" IS NULL OR "disclosure_checks"."confidence_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "disclosure_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"severity" "disclosure_check_status" NOT NULL,
	"page_number" integer,
	"tz" text,
	"review_status" "disclosure_review_status" DEFAULT 'open' NOT NULL,
	"prepared_by_user_id" text,
	"prepared_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_findings_title_check" CHECK (length("disclosure_findings"."title") BETWEEN 1 AND 60),
	CONSTRAINT "disclosure_findings_severity_check" CHECK ("disclosure_findings"."severity" <> 'match'),
	CONSTRAINT "disclosure_findings_four_eyes_check" CHECK ("disclosure_findings"."reviewed_by_user_id" IS NULL OR "disclosure_findings"."prepared_by_user_id" IS NULL OR "disclosure_findings"."reviewed_by_user_id" <> "disclosure_findings"."prepared_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "disclosure_model_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"batch_key" text NOT NULL,
	"provider" "disclosure_invocation_provider" NOT NULL,
	"route_provider" text NOT NULL,
	"model_id" text NOT NULL,
	"item_count" integer NOT NULL,
	"status" "disclosure_invocation_status" DEFAULT 'started' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_microunits" integer,
	"latency_milliseconds" integer,
	"error_code" text,
	"response" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "disclosure_model_invocations_batch_key_check" CHECK ("disclosure_model_invocations"."batch_key" ~ '^[0-9a-f]{64}$' AND "disclosure_model_invocations"."item_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "disclosure_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" "disclosure_run_kind" DEFAULT 'plausibility' NOT NULL,
	"status" "disclosure_run_status" DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"report_case_document_id" uuid NOT NULL,
	"report_policy_version_id" uuid NOT NULL,
	"report_sha256" text NOT NULL,
	"report_parser_version" text NOT NULL,
	"extraction_version" text NOT NULL,
	"check_version" text NOT NULL,
	"configuration_hash" text NOT NULL,
	"route_provider" text,
	"provider_model_id" text,
	"model_profile_id" text,
	"model_catalogue_version" text,
	"prompt_version" text,
	"ai_credential_id" uuid,
	"assist_credential_id" uuid,
	"credential_deadline_at" timestamp with time zone,
	"workflow_run_id" text,
	"figure_count" integer DEFAULT 0 NOT NULL,
	"planned_check_count" integer,
	"assignment_batch_count" integer DEFAULT 0 NOT NULL,
	"failed_batch_count" integer DEFAULT 0 NOT NULL,
	"mismatch_count" integer DEFAULT 0 NOT NULL,
	"uncertain_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_runs_model_check" CHECK (("disclosure_runs"."route_provider" IS NULL) = ("disclosure_runs"."provider_model_id" IS NULL)
        AND ("disclosure_runs"."route_provider" IS NULL OR "disclosure_runs"."prompt_version" IS NOT NULL)),
	CONSTRAINT "disclosure_runs_failure_detail_check" CHECK (length("disclosure_runs"."failure_detail") <= 700)
);
--> statement-breakpoint
ALTER TABLE "disclosure_checks" ADD CONSTRAINT "disclosure_checks_run_id_disclosure_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."disclosure_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checks" ADD CONSTRAINT "disclosure_checks_subject_figure_id_disclosure_figures_id_fk" FOREIGN KEY ("subject_figure_id") REFERENCES "public"."disclosure_figures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checks" ADD CONSTRAINT "disclosure_checks_statement_id_disclosure_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."disclosure_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_findings" ADD CONSTRAINT "disclosure_findings_run_id_disclosure_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."disclosure_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_findings" ADD CONSTRAINT "disclosure_findings_check_id_disclosure_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."disclosure_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_findings" ADD CONSTRAINT "disclosure_findings_prepared_by_user_id_users_id_fk" FOREIGN KEY ("prepared_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_findings" ADD CONSTRAINT "disclosure_findings_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_model_invocations" ADD CONSTRAINT "disclosure_model_invocations_run_id_disclosure_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."disclosure_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD CONSTRAINT "disclosure_runs_case_id_disclosure_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."disclosure_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD CONSTRAINT "disclosure_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD CONSTRAINT "disclosure_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD CONSTRAINT "disclosure_runs_report_case_document_id_disclosure_case_documents_id_fk" FOREIGN KEY ("report_case_document_id") REFERENCES "public"."disclosure_case_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD CONSTRAINT "disclosure_runs_report_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("report_policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_checks_run_subject_uidx" ON "disclosure_checks" USING btree ("run_id","kind","subject_key","source_key");--> statement-breakpoint
CREATE INDEX "disclosure_checks_run_figure_idx" ON "disclosure_checks" USING btree ("run_id","subject_figure_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_findings_run_check_uidx" ON "disclosure_findings" USING btree ("run_id","check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_findings_run_ordinal_uidx" ON "disclosure_findings" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_model_invocations_batch_uidx" ON "disclosure_model_invocations" USING btree ("run_id","batch_key");--> statement-breakpoint
CREATE INDEX "disclosure_runs_case_created_idx" ON "disclosure_runs" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_runs_workflow_run_uidx" ON "disclosure_runs" USING btree ("workflow_run_id") WHERE "disclosure_runs"."workflow_run_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_runs_one_open_uidx" ON "disclosure_runs" USING btree ("case_id","kind") WHERE "disclosure_runs"."status" IN ('queued', 'running');