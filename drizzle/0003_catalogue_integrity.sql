ALTER TABLE "public"."regulatory_frameworks"
ADD CONSTRAINT "regulatory_frameworks_region_check"
CHECK ("region" IN ('DE', 'EU', 'International'));
--> statement-breakpoint
ALTER TABLE "public"."regulatory_framework_releases"
ADD CONSTRAINT "regulatory_framework_releases_effective_dates_check"
CHECK (
  "effective_until" IS NULL
  OR "effective_from" IS NULL
  OR "effective_until" >= "effective_from"
);
--> statement-breakpoint
ALTER TABLE "public"."regulatory_framework_releases"
ADD CONSTRAINT "regulatory_framework_releases_publication_check"
CHECK (
  ("status" = 'draft' AND "archived_at" IS NULL)
  OR (
    "status" = 'published'
    AND "published_at" IS NOT NULL
    AND "content_hash" ~ '^[0-9a-f]{64}$'
    AND "archived_at" IS NULL
  )
  OR (
    "status" = 'archived'
    AND "published_at" IS NOT NULL
    AND "content_hash" ~ '^[0-9a-f]{64}$'
    AND "archived_at" IS NOT NULL
  )
);
--> statement-breakpoint
ALTER TABLE "public"."regulatory_requirements"
ADD CONSTRAINT "regulatory_requirements_display_order_check"
CHECK ("display_order" > 0);
--> statement-breakpoint
ALTER TABLE "public"."regulatory_requirements"
ADD CONSTRAINT "regulatory_requirements_content_hash_check"
CHECK ("content_hash" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "public"."regulatory_subrequirements"
ADD CONSTRAINT "regulatory_subrequirements_display_order_check"
CHECK ("display_order" > 0);
--> statement-breakpoint
ALTER TABLE "public"."regulatory_subrequirements"
ADD CONSTRAINT "regulatory_subrequirements_content_hash_check"
CHECK ("content_hash" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "public"."regulatory_requirements"
ADD CONSTRAINT "regulatory_requirements_id_release_unique"
UNIQUE ("id", "release_id");
--> statement-breakpoint
ALTER TABLE "public"."regulatory_subrequirements"
ADD CONSTRAINT "regulatory_subrequirements_parent_release_fk"
FOREIGN KEY ("parent_requirement_id", "release_id")
REFERENCES "public"."regulatory_requirements" ("id", "release_id")
ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."require_draft_regulatory_release"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_release_id uuid;
  target_release_status framework_release_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_release_id := OLD.release_id;
  ELSE
    target_release_id := NEW.release_id;
  END IF;

  SELECT "status"
  INTO target_release_status
  FROM "public"."regulatory_framework_releases"
  WHERE "id" = target_release_id;

  IF target_release_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'published regulatory release content is immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "regulatory_requirements_draft_only"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."regulatory_requirements"
FOR EACH ROW
EXECUTE FUNCTION "public"."require_draft_regulatory_release"();
--> statement-breakpoint
CREATE TRIGGER "regulatory_subrequirements_draft_only"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."regulatory_subrequirements"
FOR EACH ROW
EXECUTE FUNCTION "public"."require_draft_regulatory_release"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_regulatory_release_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'published or archived regulatory releases cannot be deleted';
    END IF;

    RETURN OLD;
  END IF;

  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'archived regulatory releases are immutable';
  END IF;

  IF OLD.status = 'published' THEN
    IF NEW.status = 'archived'
      AND NEW.archived_at IS NOT NULL
      AND NEW.framework_id IS NOT DISTINCT FROM OLD.framework_id
      AND NEW.version IS NOT DISTINCT FROM OLD.version
      AND NEW.authoritative_language IS NOT DISTINCT FROM OLD.authoritative_language
      AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from
      AND NEW.effective_until IS NOT DISTINCT FROM OLD.effective_until
      AND NEW.source_title IS NOT DISTINCT FROM OLD.source_title
      AND NEW.source_url IS NOT DISTINCT FROM OLD.source_url
      AND NEW.source_locator IS NOT DISTINCT FROM OLD.source_locator
      AND NEW.source_retrieved_at IS NOT DISTINCT FROM OLD.source_retrieved_at
      AND NEW.content_classification IS NOT DISTINCT FROM OLD.content_classification
      AND NEW.provenance_note IS NOT DISTINCT FROM OLD.provenance_note
      AND NEW.reuse_notice IS NOT DISTINCT FROM OLD.reuse_notice
      AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
      AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
      AND NEW.published_by_user_id IS NOT DISTINCT FROM OLD.published_by_user_id
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'published regulatory release metadata is immutable';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "regulatory_framework_releases_history_guard"
BEFORE UPDATE OR DELETE ON "public"."regulatory_framework_releases"
FOR EACH ROW
EXECUTE FUNCTION "public"."protect_regulatory_release_history"();
