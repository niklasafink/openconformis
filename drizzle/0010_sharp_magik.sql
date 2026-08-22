ALTER TYPE "public"."policy_parse_status" ADD VALUE 'ocr_processing' BEFORE 'needs_ocr_review';--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "processed_object_key" text;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "processed_sha256" text;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "ocr_engine_version" text;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "ocr_completed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_processed_object_key_uidx" ON "policy_versions" USING btree ("processed_object_key") WHERE "policy_versions"."processed_object_key" is not null;