CREATE TYPE "public"."job_outbox_status" AS ENUM('pending', 'published', 'dead');--> statement-breakpoint
CREATE TABLE "job_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_name" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"last_error_code" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_outbox_deduplication_key_uidx" ON "job_outbox" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "job_outbox_dispatch_idx" ON "job_outbox" USING btree ("status","available_at","created_at");