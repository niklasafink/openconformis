CREATE TYPE "public"."disclosure_evidence_status" AS ENUM('awaiting_upload', 'uploaded', 'parsing', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."disclosure_check_kind" ADD VALUE 'evidence';--> statement-breakpoint
CREATE TABLE "disclosure_evidence_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_file_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"account_number" text NOT NULL,
	"label" text NOT NULL,
	"opening_micro" bigint,
	"debit_micro" bigint,
	"credit_micro" bigint,
	"closing_micro" bigint NOT NULL,
	"posten_key" text,
	CONSTRAINT "disclosure_evidence_accounts_number_check" CHECK ("disclosure_evidence_accounts"."account_number" ~ '^[0-9]{3,9}$')
);
--> statement-breakpoint
CREATE TABLE "disclosure_evidence_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"kind" text DEFAULT 'susa_xlsx' NOT NULL,
	"filename" text NOT NULL,
	"object_key" text NOT NULL,
	"declared_byte_size" integer NOT NULL,
	"sha256" text,
	"status" "disclosure_evidence_status" DEFAULT 'awaiting_upload' NOT NULL,
	"parser_version" text,
	"error_code" text,
	"account_count" integer DEFAULT 0 NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"delete_after" timestamp with time zone NOT NULL,
	"original_deleted_at" timestamp with time zone,
	"parsed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_evidence_files_kind_check" CHECK ("disclosure_evidence_files"."kind" = 'susa_xlsx'),
	CONSTRAINT "disclosure_evidence_files_filename_check" CHECK (length(btrim("disclosure_evidence_files"."filename")) between 1 and 255),
	CONSTRAINT "disclosure_evidence_files_size_check" CHECK ("disclosure_evidence_files"."declared_byte_size" between 1 and 10485760)
);
--> statement-breakpoint
ALTER TABLE "disclosure_runs" ADD COLUMN "evidence_file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "disclosure_evidence_accounts" ADD CONSTRAINT "disclosure_evidence_accounts_evidence_file_id_disclosure_evidence_files_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."disclosure_evidence_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_evidence_files" ADD CONSTRAINT "disclosure_evidence_files_case_id_disclosure_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."disclosure_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_evidence_files" ADD CONSTRAINT "disclosure_evidence_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_evidence_files" ADD CONSTRAINT "disclosure_evidence_files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_evidence_accounts_row_uidx" ON "disclosure_evidence_accounts" USING btree ("evidence_file_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_evidence_files_object_uidx" ON "disclosure_evidence_files" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "disclosure_evidence_files_case_idx" ON "disclosure_evidence_files" USING btree ("case_id","created_at");