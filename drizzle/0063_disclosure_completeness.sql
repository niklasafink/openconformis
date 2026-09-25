CREATE TYPE "public"."disclosure_checklist_classification" AS ENUM('demo', 'operator');--> statement-breakpoint
CREATE TYPE "public"."disclosure_checklist_release_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."disclosure_checklist_source_kind" AS ENUM('seed', 'excel_import');--> statement-breakpoint
CREATE TYPE "public"."disclosure_completeness_event_kind" AS ENUM('comment', 'confirmed', 'overridden', 'released', 'rejected');--> statement-breakpoint
CREATE TABLE "disclosure_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checklist_id" uuid NOT NULL,
	"external_key" text NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"requirement" text NOT NULL,
	"aspects" text[] DEFAULT '{}'::text[] NOT NULL,
	"parent_item_id" uuid,
	"display_order" integer NOT NULL,
	"content_hash" text NOT NULL,
	"origin_template_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_checklist_items_text_check" CHECK (length(btrim("disclosure_checklist_items"."title")) between 1 and 300 AND length(btrim("disclosure_checklist_items"."requirement")) between 1 and 6000 AND length(btrim("disclosure_checklist_items"."reference")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "disclosure_checklist_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"external_key" text NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"requirement" text NOT NULL,
	"aspects" text[] DEFAULT '{}'::text[] NOT NULL,
	"parent_item_id" uuid,
	"display_order" integer NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disclosure_checklist_template_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "disclosure_checklist_release_status" DEFAULT 'draft' NOT NULL,
	"source_kind" "disclosure_checklist_source_kind" NOT NULL,
	"source_filename" text,
	"content_hash" text NOT NULL,
	"item_count" integer NOT NULL,
	"created_by_user_id" text,
	"published_by_user_id" text,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_checklist_template_releases_version_check" CHECK ("disclosure_checklist_template_releases"."version" > 0),
	CONSTRAINT "disclosure_checklist_template_releases_published_check" CHECK ("disclosure_checklist_template_releases"."status" = 'draft' OR "disclosure_checklist_template_releases"."published_at" IS NOT NULL),
	CONSTRAINT "disclosure_checklist_template_releases_items_check" CHECK ("disclosure_checklist_template_releases"."item_count" between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "disclosure_checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"classification" "disclosure_checklist_classification" NOT NULL,
	"provenance_note" text NOT NULL,
	"reuse_notice" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_checklist_templates_key_check" CHECK ("disclosure_checklist_templates"."key" ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
	CONSTRAINT "disclosure_checklist_templates_title_check" CHECK (length(btrim("disclosure_checklist_templates"."title")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "disclosure_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"template_release_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_checklists_title_check" CHECK (length(btrim("disclosure_checklists"."title")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "disclosure_completeness_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"kind" "disclosure_completeness_event_kind" NOT NULL,
	"actor_user_id" text NOT NULL,
	"body" text,
	"override_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_completeness_events_body_check" CHECK ("disclosure_completeness_events"."body" IS NULL OR length("disclosure_completeness_events"."body") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "disclosure_completeness_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"citation_order" integer NOT NULL,
	"document_block_id" uuid NOT NULL,
	"support" "analysis_evidence_support" NOT NULL,
	"exact_quote" text NOT NULL,
	"block_text_hash" text NOT NULL,
	"page_number" integer,
	"paragraph_number" integer,
	CONSTRAINT "disclosure_completeness_evidence_order_check" CHECK ("disclosure_completeness_evidence"."citation_order" > 0)
);
--> statement-breakpoint
CREATE TABLE "disclosure_completeness_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"mentioned_user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disclosure_completeness_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"status" "analysis_result_status" NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "disclosure_completeness_overrides_reason_check" CHECK (length(btrim("disclosure_completeness_overrides"."reason")) between 8 and 2000)
);
--> statement-breakpoint
CREATE TABLE "disclosure_completeness_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"run_item_id" uuid NOT NULL,
	"status" "analysis_result_status" NOT NULL,
	"explanation" text NOT NULL,
	"missing_information" text[] DEFAULT '{}'::text[] NOT NULL,
	"confidence_basis_points" integer NOT NULL,
	"model_id" text,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"review_status" "disclosure_review_status" DEFAULT 'open' NOT NULL,
	"prepared_by_user_id" text,
	"prepared_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_completeness_results_explanation_check" CHECK (length(btrim("disclosure_completeness_results"."explanation")) between 1 and 6000),
	CONSTRAINT "disclosure_completeness_results_confidence_check" CHECK ("disclosure_completeness_results"."confidence_basis_points" between 0 and 10000),
	CONSTRAINT "disclosure_completeness_results_four_eyes_check" CHECK ("disclosure_completeness_results"."reviewed_by_user_id" IS NULL OR "disclosure_completeness_results"."prepared_by_user_id" IS NULL OR "disclosure_completeness_results"."reviewed_by_user_id" <> "disclosure_completeness_results"."prepared_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "disclosure_run_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"external_key" text NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"requirement" text NOT NULL,
	"aspects" text[] DEFAULT '{}'::text[] NOT NULL,
	"parent_key" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"content_hash" text NOT NULL,
	"template_release_id" uuid,
	"checklist_id" uuid,
	"source_item_id" uuid,
	CONSTRAINT "disclosure_run_checklist_items_origin_check" CHECK (("disclosure_run_checklist_items"."template_release_id" IS NOT NULL) <> ("disclosure_run_checklist_items"."checklist_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD COLUMN "checklist_template_release_id" uuid;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD COLUMN "checklist_id" uuid;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD COLUMN "checklist_hash" text;--> statement-breakpoint
ALTER TABLE "disclosure_checklist_items" ADD CONSTRAINT "disclosure_checklist_items_checklist_id_disclosure_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."disclosure_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklist_items" ADD CONSTRAINT "disclosure_checklist_items_parent_item_id_disclosure_checklist_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."disclosure_checklist_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklist_items" ADD CONSTRAINT "disclosure_checklist_items_origin_template_item_id_disclosure_checklist_template_items_id_fk" FOREIGN KEY ("origin_template_item_id") REFERENCES "public"."disclosure_checklist_template_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklist_template_items" ADD CONSTRAINT "disclosure_checklist_template_items_release_id_disclosure_checklist_template_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."disclosure_checklist_template_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklist_template_items" ADD CONSTRAINT "disclosure_checklist_template_items_parent_item_id_disclosure_checklist_template_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."disclosure_checklist_template_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklist_template_releases" ADD CONSTRAINT "disclosure_checklist_template_releases_template_id_disclosure_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."disclosure_checklist_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklist_template_releases" ADD CONSTRAINT "disclosure_checklist_template_releases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklist_template_releases" ADD CONSTRAINT "disclosure_checklist_template_releases_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklist_templates" ADD CONSTRAINT "disclosure_checklist_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklists" ADD CONSTRAINT "disclosure_checklists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklists" ADD CONSTRAINT "disclosure_checklists_template_release_id_disclosure_checklist_template_releases_id_fk" FOREIGN KEY ("template_release_id") REFERENCES "public"."disclosure_checklist_template_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_checklists" ADD CONSTRAINT "disclosure_checklists_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_events" ADD CONSTRAINT "disclosure_completeness_events_result_id_disclosure_completeness_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."disclosure_completeness_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_events" ADD CONSTRAINT "disclosure_completeness_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_events" ADD CONSTRAINT "disclosure_completeness_events_override_id_disclosure_completeness_overrides_id_fk" FOREIGN KEY ("override_id") REFERENCES "public"."disclosure_completeness_overrides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_evidence" ADD CONSTRAINT "disclosure_completeness_evidence_result_id_disclosure_completeness_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."disclosure_completeness_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_evidence" ADD CONSTRAINT "disclosure_completeness_evidence_document_block_id_document_blocks_id_fk" FOREIGN KEY ("document_block_id") REFERENCES "public"."document_blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_mentions" ADD CONSTRAINT "disclosure_completeness_mentions_event_id_disclosure_completeness_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."disclosure_completeness_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_mentions" ADD CONSTRAINT "disclosure_completeness_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_overrides" ADD CONSTRAINT "disclosure_completeness_overrides_result_id_disclosure_completeness_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."disclosure_completeness_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_overrides" ADD CONSTRAINT "disclosure_completeness_overrides_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_results" ADD CONSTRAINT "disclosure_completeness_results_run_id_disclosure_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."disclosure_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_results" ADD CONSTRAINT "disclosure_completeness_results_run_item_id_disclosure_run_checklist_items_id_fk" FOREIGN KEY ("run_item_id") REFERENCES "public"."disclosure_run_checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_results" ADD CONSTRAINT "disclosure_completeness_results_prepared_by_user_id_users_id_fk" FOREIGN KEY ("prepared_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_completeness_results" ADD CONSTRAINT "disclosure_completeness_results_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_run_checklist_items" ADD CONSTRAINT "disclosure_run_checklist_items_run_id_disclosure_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."disclosure_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_checklist_items_key_uidx" ON "disclosure_checklist_items" USING btree ("checklist_id","external_key");--> statement-breakpoint
CREATE INDEX "disclosure_checklist_items_order_idx" ON "disclosure_checklist_items" USING btree ("checklist_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_checklist_template_items_key_uidx" ON "disclosure_checklist_template_items" USING btree ("release_id","external_key");--> statement-breakpoint
CREATE INDEX "disclosure_checklist_template_items_order_idx" ON "disclosure_checklist_template_items" USING btree ("release_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_checklist_template_releases_version_uidx" ON "disclosure_checklist_template_releases" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "disclosure_checklist_template_releases_status_idx" ON "disclosure_checklist_template_releases" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_checklist_templates_key_uidx" ON "disclosure_checklist_templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX "disclosure_checklists_organization_idx" ON "disclosure_checklists" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "disclosure_completeness_events_result_idx" ON "disclosure_completeness_events" USING btree ("result_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_completeness_evidence_order_uidx" ON "disclosure_completeness_evidence" USING btree ("result_id","citation_order");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_completeness_mentions_event_user_uidx" ON "disclosure_completeness_mentions" USING btree ("event_id","mentioned_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_completeness_overrides_active_uidx" ON "disclosure_completeness_overrides" USING btree ("result_id") WHERE "disclosure_completeness_overrides"."superseded_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_completeness_results_item_uidx" ON "disclosure_completeness_results" USING btree ("run_item_id");--> statement-breakpoint
CREATE INDEX "disclosure_completeness_results_run_idx" ON "disclosure_completeness_results" USING btree ("run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_run_checklist_items_ordinal_uidx" ON "disclosure_run_checklist_items" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_run_checklist_items_key_uidx" ON "disclosure_run_checklist_items" USING btree ("run_id","external_key");--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD CONSTRAINT "disclosure_runs_checklist_check" CHECK ("disclosure_runs"."kind" <> 'completeness' OR (("disclosure_runs"."checklist_template_release_id" IS NOT NULL) <> ("disclosure_runs"."checklist_id" IS NOT NULL) AND "disclosure_runs"."checklist_hash" IS NOT NULL));