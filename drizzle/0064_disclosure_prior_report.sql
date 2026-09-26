CREATE TYPE "public"."disclosure_statement_kind" AS ENUM('direction', 'year');--> statement-breakpoint
ALTER TYPE "public"."disclosure_check_kind" ADD VALUE 'rollover';--> statement-breakpoint
ALTER TYPE "public"."disclosure_check_kind" ADD VALUE 'prior_report';--> statement-breakpoint
ALTER TYPE "public"."disclosure_check_source_kind" ADD VALUE 'prior_report';--> statement-breakpoint
ALTER TABLE "disclosure_statements" ALTER COLUMN "direction" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD COLUMN "prior_case_document_id" uuid;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD COLUMN "prior_report_sha256" text;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD COLUMN "prior_extraction_version" text;--> statement-breakpoint
ALTER TABLE "disclosure_statements" ADD COLUMN "kind" "disclosure_statement_kind" DEFAULT 'direction' NOT NULL;--> statement-breakpoint
ALTER TABLE "disclosure_statements" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD CONSTRAINT "disclosure_runs_prior_case_document_id_disclosure_case_documents_id_fk" FOREIGN KEY ("prior_case_document_id") REFERENCES "public"."disclosure_case_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_case_documents_one_prior_report_uidx" ON "disclosure_case_documents" USING btree ("case_id") WHERE "disclosure_case_documents"."role" = 'prior_report';--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD CONSTRAINT "disclosure_runs_prior_frozen_check" CHECK (("disclosure_runs"."prior_report_sha256" IS NULL) = ("disclosure_runs"."prior_extraction_version" IS NULL));--> statement-breakpoint
ALTER TABLE "disclosure_statements" ADD CONSTRAINT "disclosure_statements_kind_check" CHECK (("disclosure_statements"."kind" = 'direction' AND "disclosure_statements"."direction" IS NOT NULL AND "disclosure_statements"."year" IS NULL)
        OR ("disclosure_statements"."kind" = 'year' AND "disclosure_statements"."direction" IS NULL AND "disclosure_statements"."year" IS NOT NULL));