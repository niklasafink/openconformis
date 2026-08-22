ALTER TABLE "public"."policies"
ADD CONSTRAINT "policies_single_owner_check"
CHECK (num_nonnulls("organization_id", "anonymous_draft_id") = 1);
--> statement-breakpoint
ALTER TABLE "public"."policies"
ADD CONSTRAINT "policies_lifecycle_check"
CHECK (
  ("lifecycle_status" = 'active' AND "deleted_at" IS NULL)
  OR ("lifecycle_status" = 'deleting' AND "deletion_requested_at" IS NOT NULL AND "deleted_at" IS NULL)
  OR ("lifecycle_status" = 'deleted' AND "deletion_requested_at" IS NOT NULL AND "deleted_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "public"."policy_versions"
ADD CONSTRAINT "policy_versions_single_owner_check"
CHECK (num_nonnulls("organization_id", "anonymous_draft_id") = 1);
--> statement-breakpoint
ALTER TABLE "public"."policy_versions"
ADD CONSTRAINT "policy_versions_metadata_check"
CHECK (
  "version_number" > 0
  AND ("byte_size" IS NULL OR "byte_size" BETWEEN 1 AND 26214400)
  AND ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$')
  AND ("page_count" IS NULL OR "page_count" > 0)
  AND "parsed_delete_after" >= "original_delete_after"
  AND "object_key" !~ '(^/|\.\.)'
);
--> statement-breakpoint
ALTER TABLE "public"."policy_versions"
ADD CONSTRAINT "policy_versions_ready_check"
CHECK (
  "parse_status" NOT IN ('ready', 'needs_ocr_review')
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
--> statement-breakpoint
ALTER TABLE "public"."policy_versions"
ADD CONSTRAINT "policy_versions_deletion_state_check"
CHECK (
  (
    "parse_status" = 'deleting'
    AND "deletion_requested_at" IS NOT NULL
    AND "deleted_at" IS NULL
  )
  OR (
    "parse_status" = 'deleted'
    AND "deletion_requested_at" IS NOT NULL
    AND "deleted_at" IS NOT NULL
  )
  OR (
    "parse_status" NOT IN ('deleting', 'deleted')
    AND "deleted_at" IS NULL
  )
);
--> statement-breakpoint
ALTER TABLE "public"."document_blocks"
ADD CONSTRAINT "document_blocks_content_check"
CHECK (
  "ordinal" > 0
  AND length(btrim("canonical_text")) > 0
  AND "text_hash" ~ '^[0-9a-f]{64}$'
  AND ("page_number" IS NULL OR "page_number" > 0)
  AND ("paragraph_number" IS NULL OR "paragraph_number" > 0)
  AND ("token_count" IS NULL OR "token_count" >= 0)
  AND (
    ("start_offset" IS NULL AND "end_offset" IS NULL)
    OR ("start_offset" >= 0 AND "end_offset" > "start_offset")
  )
);
--> statement-breakpoint
ALTER TABLE "public"."policy_upload_intents"
ADD CONSTRAINT "policy_upload_intents_metadata_check"
CHECK (
  "declared_byte_size" BETWEEN 1 AND 26214400
  AND "declared_mime_type" IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
  AND "expires_at" > "created_at"
  AND "object_key" !~ '(^/|\.\.)'
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_policy_version_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_organization_id text;
  parent_anonymous_draft_id uuid;
BEGIN
  SELECT "organization_id", "anonymous_draft_id"
  INTO parent_organization_id, parent_anonymous_draft_id
  FROM "public"."policies"
  WHERE "id" = NEW.policy_id;

  IF NOT FOUND
    OR NEW.organization_id IS DISTINCT FROM parent_organization_id
    OR NEW.anonymous_draft_id IS DISTINCT FROM parent_anonymous_draft_id
  THEN
    RAISE EXCEPTION 'policy version ownership must match its policy';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "policy_versions_owner_guard"
BEFORE INSERT OR UPDATE ON "public"."policy_versions"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_policy_version_owner"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_ready_policy_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.parse_status = 'ready' THEN
    IF NEW.parse_status = 'deleting'
      AND (
        to_jsonb(NEW) - ARRAY['parse_status', 'deletion_requested_at', 'deleted_at']
      ) IS NOT DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['parse_status', 'deletion_requested_at', 'deleted_at']
      )
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'ready policy versions are immutable';
  END IF;

  IF OLD.parse_status = 'deleting' THEN
    IF NEW.parse_status = 'deleted'
      AND NEW.deletion_requested_at IS NOT DISTINCT FROM OLD.deletion_requested_at
      AND (
        to_jsonb(NEW) - ARRAY['parse_status', 'deletion_requested_at', 'deleted_at']
      ) IS NOT DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['parse_status', 'deletion_requested_at', 'deleted_at']
      )
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'deleting policy versions may only transition to deleted';
  END IF;

  IF OLD.parse_status = 'deleted' THEN
    RAISE EXCEPTION 'deleted policy versions are immutable';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "policy_versions_immutable_when_ready"
BEFORE UPDATE ON "public"."policy_versions"
FOR EACH ROW
EXECUTE FUNCTION "public"."protect_ready_policy_version"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_ready_document_blocks"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_status policy_parse_status;
  target_version_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_version_id := OLD.policy_version_id;
  ELSE
    target_version_id := NEW.policy_version_id;
  END IF;

  SELECT "parse_status"
  INTO version_status
  FROM "public"."policy_versions"
  WHERE "id" = target_version_id;

  IF version_status = 'ready' OR version_status = 'deleted' THEN
    RAISE EXCEPTION 'document blocks of a ready policy version are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "document_blocks_immutable_when_ready"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."document_blocks"
FOR EACH ROW
EXECUTE FUNCTION "public"."protect_ready_document_blocks"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_draft_policy_selection"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_draft_id uuid;
  selected_status policy_parse_status;
BEGIN
  SELECT "anonymous_draft_id", "parse_status"
  INTO selected_draft_id, selected_status
  FROM "public"."policy_versions"
  WHERE "id" = NEW.policy_version_id;

  IF selected_draft_id IS DISTINCT FROM NEW.anonymous_draft_id OR selected_status <> 'ready' THEN
    RAISE EXCEPTION 'draft selection requires an owned, ready policy version';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "draft_policy_selections_owner_guard"
BEFORE INSERT OR UPDATE ON "public"."draft_policy_selections"
FOR EACH ROW
EXECUTE FUNCTION "public"."validate_draft_policy_selection"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_policy_upload_intent"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_draft_id uuid;
  version_object_key text;
BEGIN
  SELECT "anonymous_draft_id", "object_key"
  INTO version_draft_id, version_object_key
  FROM "public"."policy_versions"
  WHERE "id" = NEW.policy_version_id;

  IF version_draft_id IS DISTINCT FROM NEW.anonymous_draft_id
    OR version_object_key IS DISTINCT FROM NEW.object_key
  THEN
    RAISE EXCEPTION 'upload intent must match its owned policy version';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "policy_upload_intents_owner_guard"
BEFORE INSERT OR UPDATE ON "public"."policy_upload_intents"
FOR EACH ROW
EXECUTE FUNCTION "public"."validate_policy_upload_intent"();
