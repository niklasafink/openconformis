ALTER TYPE "public"."job_outbox_status" ADD VALUE 'publishing' BEFORE 'published';--> statement-breakpoint
ALTER TABLE "job_outbox" ADD COLUMN "locked_at" timestamp with time zone;