ALTER TABLE "public"."job_outbox"
ADD CONSTRAINT "job_outbox_content_check"
CHECK (
  "attempts" >= 0
  AND "queue_name" ~ '^[a-z][a-z0-9-]{0,62}$'
  AND length("deduplication_key") BETWEEN 1 AND 255
  AND jsonb_typeof("payload") = 'object'
  AND ("payload"->>'policyVersionId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (
    ("status" = 'pending' AND "published_at" IS NULL)
    OR ("status" = 'publishing' AND "locked_at" IS NOT NULL AND "published_at" IS NULL)
    OR ("status" = 'published' AND "published_at" IS NOT NULL)
    OR ("status" = 'dead' AND "published_at" IS NULL)
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_published_outbox_job"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published outbox jobs are immutable';
  END IF;

  IF NEW.queue_name IS DISTINCT FROM OLD.queue_name
    OR NEW.deduplication_key IS DISTINCT FROM OLD.deduplication_key
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'outbox job identity and payload are immutable';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "job_outbox_immutability_guard"
BEFORE UPDATE ON "public"."job_outbox"
FOR EACH ROW
EXECUTE FUNCTION "public"."protect_published_outbox_job"();
