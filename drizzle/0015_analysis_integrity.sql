ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_progress_range_check"
CHECK ("progress_percent" BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_requirement_count_positive_check"
CHECK ("requirement_count" > 0);
--> statement-breakpoint
ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_funding_grant_check"
CHECK (
  ("funding_mode" = 'sponsored' AND "sponsored_grant_id" IS NOT NULL)
  OR ("funding_mode" = 'byok' AND "sponsored_grant_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_completion_state_check"
CHECK (
  ("status" = 'completed' AND "stage" = 'completed' AND "progress_percent" = 100 AND "completed_at" IS NOT NULL)
  OR ("status" <> 'completed' AND "stage" <> 'completed' AND "completed_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_failure_code_check"
CHECK (
  ("status" = 'failed' AND "failure_code" IS NOT NULL)
  OR ("status" <> 'failed' AND "failure_code" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_sponsored_grant_uidx"
ON "public"."analyses" USING btree ("sponsored_grant_id")
WHERE "sponsored_grant_id" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_ready_policy_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_draft_status "public"."anonymous_draft_status";
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

    IF OLD."anonymous_draft_id" IS NOT NULL
      AND NEW."anonymous_draft_id" IS NULL
      AND NEW."organization_id" IS NOT NULL
      AND (
        to_jsonb(NEW) - ARRAY['organization_id', 'anonymous_draft_id']
      ) IS NOT DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['organization_id', 'anonymous_draft_id']
      )
    THEN
      SELECT "status"
      INTO source_draft_status
      FROM "public"."anonymous_drafts"
      WHERE "id" = OLD."anonymous_draft_id";

      IF source_draft_status = 'claimed' THEN
        RETURN NEW;
      END IF;
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
CREATE OR REPLACE FUNCTION "public"."enforce_analysis_ownership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  draft_status "public"."anonymous_draft_status";
  draft_user_id text;
  policy_organization_id text;
  grant_user_id text;
BEGIN
  SELECT "status", "claimed_by_user_id"
  INTO draft_status, draft_user_id
  FROM "public"."anonymous_drafts"
  WHERE "id" = NEW."source_draft_id";

  IF draft_status <> 'claimed' OR draft_user_id IS DISTINCT FROM NEW."owner_user_id" THEN
    RAISE EXCEPTION 'analysis source draft is not claimed by the owner';
  END IF;

  SELECT "organization_id"
  INTO policy_organization_id
  FROM "public"."policy_versions"
  WHERE "id" = NEW."policy_version_id";

  IF policy_organization_id IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION 'analysis policy is not owned by the organization';
  END IF;

  IF NEW."sponsored_grant_id" IS NOT NULL THEN
    SELECT "user_id"
    INTO grant_user_id
    FROM "public"."sponsored_run_grants"
    WHERE "id" = NEW."sponsored_grant_id";

    IF grant_user_id IS DISTINCT FROM NEW."owner_user_id" THEN
      RAISE EXCEPTION 'analysis sponsored grant is not owned by the user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "analyses_enforce_ownership"
BEFORE INSERT OR UPDATE OF "organization_id", "owner_user_id", "source_draft_id", "policy_version_id", "sponsored_grant_id"
ON "public"."analyses"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_analysis_ownership"();
