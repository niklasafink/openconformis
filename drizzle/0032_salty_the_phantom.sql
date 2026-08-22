CREATE TYPE "public"."analysis_instruction_kind" AS ENUM('assessment', 'verification');--> statement-breakpoint
CREATE TYPE "public"."analysis_instruction_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "analysis_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "analysis_instruction_kind" NOT NULL,
	"version" text NOT NULL,
	"status" "analysis_instruction_status" DEFAULT 'draft' NOT NULL,
	"instruction" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_by_user_id" text,
	"published_by_user_id" text,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_instructions_content_check" CHECK (length(btrim("analysis_instructions"."version")) between 1 and 100
        AND length(btrim("analysis_instructions"."instruction")) between 40 and 20000
        AND "analysis_instructions"."content_hash" ~ '^[0-9a-f]{64}$'
        AND (
          ("analysis_instructions"."status" = 'draft' AND "analysis_instructions"."published_at" IS NULL)
          OR ("analysis_instructions"."status" IN ('published', 'archived') AND "analysis_instructions"."published_at" IS NOT NULL)
        ))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"build_id" text NOT NULL,
	"healthy" boolean DEFAULT true NOT NULL,
	"safe_status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "assessment_instruction_id" uuid;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "assessment_instruction_hash" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "verification_instruction_id" uuid;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "verification_instruction_hash" text;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "original_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "parsed_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "analysis_instructions" ADD CONSTRAINT "analysis_instructions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_instructions" ADD CONSTRAINT "analysis_instructions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_instructions_kind_version_uidx" ON "analysis_instructions" USING btree ("kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_instructions_one_published_kind_uidx" ON "analysis_instructions" USING btree ("kind") WHERE "analysis_instructions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "analysis_instructions_status_idx" ON "analysis_instructions" USING btree ("status","kind","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_windows_subject_uidx" ON "rate_limit_windows" USING btree ("bucket","subject_hash","window_started_at");--> statement-breakpoint
CREATE INDEX "rate_limit_windows_expiry_idx" ON "rate_limit_windows" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "worker_heartbeats_last_seen_idx" ON "worker_heartbeats" USING btree ("last_seen_at");--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_assessment_instruction_id_analysis_instructions_id_fk" FOREIGN KEY ("assessment_instruction_id") REFERENCES "public"."analysis_instructions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_verification_instruction_id_analysis_instructions_id_fk" FOREIGN KEY ("verification_instruction_id") REFERENCES "public"."analysis_instructions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_published_analysis_instruction_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('published', 'archived') AND (
    NEW.kind IS DISTINCT FROM OLD.kind OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.instruction IS DISTINCT FROM OLD.instruction OR
    NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
    NEW.published_at IS DISTINCT FROM OLD.published_at OR
    NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
  ) THEN
    RAISE EXCEPTION 'Published analysis instructions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER analysis_instructions_immutable_trigger
BEFORE UPDATE ON analysis_instructions
FOR EACH ROW EXECUTE FUNCTION prevent_published_analysis_instruction_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_non_draft_analysis_instruction_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Published analysis instructions cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER analysis_instructions_delete_trigger
BEFORE DELETE ON analysis_instructions
FOR EACH ROW EXECUTE FUNCTION prevent_non_draft_analysis_instruction_delete();
