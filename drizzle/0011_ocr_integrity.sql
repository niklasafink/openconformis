-- Custom SQL migration file, put your code below! --
ALTER TABLE "public"."policy_versions"
ADD CONSTRAINT "policy_versions_ocr_derivative_check"
CHECK (
  (
    "processed_object_key" IS NULL
    AND "processed_sha256" IS NULL
    AND "ocr_engine_version" IS NULL
    AND "ocr_completed_at" IS NULL
  )
  OR (
    "processed_object_key" IS NOT NULL
    AND "processed_object_key" !~ '(^/|\.\.)'
    AND "processed_object_key" <> "object_key"
    AND "processed_sha256" ~ '^[0-9a-f]{64}$'
    AND "ocr_engine_version" IS NOT NULL
    AND "ocr_completed_at" IS NOT NULL
    AND "detected_mime_type" = 'application/pdf'
  )
);
--> statement-breakpoint
ALTER TABLE "public"."policy_versions"
ADD CONSTRAINT "policy_versions_ocr_ready_check"
CHECK (
  "parse_status" <> 'ready'
  OR "ocr_engine_version" IS NULL
  OR "processed_object_key" IS NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public"."policy_versions"
DROP CONSTRAINT "policy_versions_ready_check";
--> statement-breakpoint
ALTER TABLE "public"."policy_versions"
ADD CONSTRAINT "policy_versions_ready_check"
CHECK (
  "parse_status" <> 'ready'
  OR (
    "detected_mime_type" IN (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    AND "byte_size" IS NOT NULL
    AND "sha256" ~ '^[0-9a-f]{64}$'
    AND "parser_version" IS NOT NULL
    AND "page_count" IS NOT NULL
    AND "authoritative_language" IS NOT NULL
    AND "ready_at" IS NOT NULL
  )
);
