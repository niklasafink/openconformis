CREATE TYPE "public"."disclosure_direction" AS ENUM('up', 'down', 'flat');--> statement-breakpoint
CREATE TYPE "public"."disclosure_figure_unit" AS ENUM('EUR', 'percent', 'count', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."disclosure_period_hint" AS ENUM('current', 'prior', 'other');--> statement-breakpoint
CREATE TYPE "public"."disclosure_recognition_status" AS ENUM('pending', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "disclosure_block_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_document_id" uuid NOT NULL,
	"document_block_id" uuid NOT NULL,
	"page_number" integer,
	"tz" text,
	"table_index" integer,
	"row_index" integer,
	"column_index" integer,
	"is_header" boolean DEFAULT false NOT NULL,
	"row_label" text,
	"column_label" text,
	"table_caption" text,
	"technical" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disclosure_figures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_document_id" uuid NOT NULL,
	"document_block_id" uuid NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"raw_text" text NOT NULL,
	"value_micro" bigint,
	"scale" integer NOT NULL,
	"unit" "disclosure_figure_unit" NOT NULL,
	"display_unit_micro" bigint NOT NULL,
	"decimals" integer NOT NULL,
	"period_hint" "disclosure_period_hint",
	"parse_issue" text,
	"parenthesized" boolean DEFAULT false NOT NULL,
	"row_label" text,
	"extraction_version" text NOT NULL,
	CONSTRAINT "disclosure_figures_offsets_check" CHECK ("disclosure_figures"."start_offset" >= 0 AND "disclosure_figures"."end_offset" > "disclosure_figures"."start_offset")
);
--> statement-breakpoint
CREATE TABLE "disclosure_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_document_id" uuid NOT NULL,
	"document_block_id" uuid NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"raw_text" text NOT NULL,
	"direction" "disclosure_direction" NOT NULL,
	"extraction_version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disclosure_case_documents" ADD COLUMN "recognition_status" "disclosure_recognition_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "disclosure_case_documents" ADD COLUMN "recognition_version" text;--> statement-breakpoint
ALTER TABLE "disclosure_case_documents" ADD COLUMN "recognition_workflow_run_id" text;--> statement-breakpoint
ALTER TABLE "disclosure_case_documents" ADD COLUMN "recognition_error_code" text;--> statement-breakpoint
ALTER TABLE "disclosure_case_documents" ADD COLUMN "recognized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disclosure_case_documents" ADD COLUMN "report_year" integer;--> statement-breakpoint
ALTER TABLE "disclosure_case_documents" ADD COLUMN "table_structure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "disclosure_block_context" ADD CONSTRAINT "disclosure_block_context_case_document_id_disclosure_case_documents_id_fk" FOREIGN KEY ("case_document_id") REFERENCES "public"."disclosure_case_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_block_context" ADD CONSTRAINT "disclosure_block_context_document_block_id_document_blocks_id_fk" FOREIGN KEY ("document_block_id") REFERENCES "public"."document_blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_figures" ADD CONSTRAINT "disclosure_figures_case_document_id_disclosure_case_documents_id_fk" FOREIGN KEY ("case_document_id") REFERENCES "public"."disclosure_case_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_figures" ADD CONSTRAINT "disclosure_figures_document_block_id_document_blocks_id_fk" FOREIGN KEY ("document_block_id") REFERENCES "public"."document_blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_statements" ADD CONSTRAINT "disclosure_statements_case_document_id_disclosure_case_documents_id_fk" FOREIGN KEY ("case_document_id") REFERENCES "public"."disclosure_case_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_statements" ADD CONSTRAINT "disclosure_statements_document_block_id_document_blocks_id_fk" FOREIGN KEY ("document_block_id") REFERENCES "public"."document_blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_block_context_block_uidx" ON "disclosure_block_context" USING btree ("case_document_id","document_block_id");--> statement-breakpoint
CREATE INDEX "disclosure_block_context_table_idx" ON "disclosure_block_context" USING btree ("case_document_id","table_index","row_index");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_figures_block_offset_uidx" ON "disclosure_figures" USING btree ("case_document_id","document_block_id","start_offset");--> statement-breakpoint
CREATE INDEX "disclosure_figures_case_document_idx" ON "disclosure_figures" USING btree ("case_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_statements_block_offset_uidx" ON "disclosure_statements" USING btree ("case_document_id","document_block_id","start_offset");--> statement-breakpoint
CREATE INDEX "disclosure_statements_case_document_idx" ON "disclosure_statements" USING btree ("case_document_id");