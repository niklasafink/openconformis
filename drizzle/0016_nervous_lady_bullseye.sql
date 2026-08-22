CREATE TYPE "public"."analysis_result_status" AS ENUM('fulfilled', 'partially_fulfilled', 'not_fulfilled', 'not_applicable', 'no_assessment_possible');--> statement-breakpoint
CREATE TYPE "public"."analysis_verification_status" AS ENUM('pending', 'passed', 'needs_review', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."analysis_evidence_support" AS ENUM('supports', 'contradicts', 'context');--> statement-breakpoint
CREATE TYPE "public"."model_invocation_status" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "analysis_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"document_block_id" uuid NOT NULL,
	"citation_order" integer NOT NULL,
	"support" "analysis_evidence_support" NOT NULL,
	"exact_quote" text NOT NULL,
	"block_text_hash" text NOT NULL,
	"page_number" integer,
	"paragraph_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_model_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"scope_item_id" uuid,
	"invocation_stage" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_request_id" text,
	"status" "model_invocation_status" DEFAULT 'started' NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text,
	"cache_key" text,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"cost_microunits" integer,
	"latency_milliseconds" integer,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analysis_requirement_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"scope_item_id" uuid NOT NULL,
	"status" "analysis_result_status" NOT NULL,
	"explanation" text NOT NULL,
	"missing_information" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"confidence_basis_points" integer NOT NULL,
	"verification_status" "analysis_verification_status" DEFAULT 'pending' NOT NULL,
	"verifier_explanation" text,
	"assessment_model_id" text NOT NULL,
	"verifier_model_id" text,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"confirmed_by_user_id" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_evidence" ADD CONSTRAINT "analysis_evidence_result_id_analysis_requirement_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."analysis_requirement_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_evidence" ADD CONSTRAINT "analysis_evidence_document_block_id_document_blocks_id_fk" FOREIGN KEY ("document_block_id") REFERENCES "public"."document_blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_model_invocations" ADD CONSTRAINT "analysis_model_invocations_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_model_invocations" ADD CONSTRAINT "analysis_model_invocations_scope_item_id_analysis_scope_items_id_fk" FOREIGN KEY ("scope_item_id") REFERENCES "public"."analysis_scope_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_requirement_results" ADD CONSTRAINT "analysis_requirement_results_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_requirement_results" ADD CONSTRAINT "analysis_requirement_results_scope_item_id_analysis_scope_items_id_fk" FOREIGN KEY ("scope_item_id") REFERENCES "public"."analysis_scope_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_requirement_results" ADD CONSTRAINT "analysis_requirement_results_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_evidence_result_order_uidx" ON "analysis_evidence" USING btree ("result_id","citation_order");--> statement-breakpoint
CREATE INDEX "analysis_evidence_result_idx" ON "analysis_evidence" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "analysis_evidence_block_idx" ON "analysis_evidence" USING btree ("document_block_id");--> statement-breakpoint
CREATE INDEX "analysis_model_invocations_analysis_started_idx" ON "analysis_model_invocations" USING btree ("analysis_id","started_at");--> statement-breakpoint
CREATE INDEX "analysis_model_invocations_cache_idx" ON "analysis_model_invocations" USING btree ("cache_key","cache_hit");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_requirement_results_scope_item_uidx" ON "analysis_requirement_results" USING btree ("scope_item_id");--> statement-breakpoint
CREATE INDEX "analysis_requirement_results_analysis_status_idx" ON "analysis_requirement_results" USING btree ("analysis_id","status");--> statement-breakpoint
CREATE INDEX "analysis_requirement_results_verification_idx" ON "analysis_requirement_results" USING btree ("analysis_id","verification_status");