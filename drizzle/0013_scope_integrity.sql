-- Custom SQL migration file, put your code below! --
ALTER TABLE "public"."draft_analysis_scopes"
ADD CONSTRAINT "draft_analysis_scopes_content_check"
CHECK (
  length(btrim("framework_slug")) > 0
  AND length(btrim("framework_release_key")) > 0
  AND "framework_content_hash" ~ '^[0-9a-f]{64}$'
  AND length("organization_context") <= 5000
);
--> statement-breakpoint
ALTER TABLE "public"."draft_requirement_selections"
ADD CONSTRAINT "draft_requirement_selections_key_check"
CHECK (length(btrim("requirement_external_key")) > 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_draft_analysis_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_framework_slug text;
  selected_status anonymous_draft_status;
BEGIN
  SELECT "framework_slug", "status"
  INTO selected_framework_slug, selected_status
  FROM "public"."anonymous_drafts"
  WHERE "id" = NEW.anonymous_draft_id;

  IF selected_status <> 'active'
    OR selected_framework_slug IS DISTINCT FROM NEW.framework_slug
  THEN
    RAISE EXCEPTION 'analysis scope must match an active draft framework';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "draft_analysis_scopes_draft_guard"
BEFORE INSERT OR UPDATE ON "public"."draft_analysis_scopes"
FOR EACH ROW
EXECUTE FUNCTION "public"."validate_draft_analysis_scope"();
