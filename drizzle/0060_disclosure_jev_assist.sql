CREATE TYPE "public"."disclosure_jev_assist" AS ENUM('on', 'off');--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD COLUMN "jev_assist" "disclosure_jev_assist" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD COLUMN "jev_model_id" text;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD CONSTRAINT "disclosure_runs_jev_frozen_check" CHECK ("disclosure_runs"."jev_assist" = 'off' OR ("disclosure_runs"."jev_model_id" IS NOT NULL AND "disclosure_runs"."assist_credential_id" IS NOT NULL AND "disclosure_runs"."route_provider" IS NOT NULL));