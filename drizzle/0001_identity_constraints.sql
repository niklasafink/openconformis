-- Custom SQL migration file, put your code below! --
CREATE UNIQUE INDEX "members_organization_id_user_id_uidx"
ON "public"."members" USING btree ("organization_id", "user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."prevent_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "public"."audit_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_audit_event_mutation"();
