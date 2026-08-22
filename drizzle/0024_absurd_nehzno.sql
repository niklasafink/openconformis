CREATE UNIQUE INDEX "ai_credentials_active_binding_uidx" ON "ai_credentials" USING btree ("owner_user_id","session_id","provider","purpose","binding_id") WHERE "ai_credentials"."status" = 'active';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_ai_credential_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."status" <> 'active' AND NEW."status" = 'active' THEN
		RAISE EXCEPTION 'terminal AI credentials cannot become active';
	END IF;

	IF OLD."status" = 'active' AND NEW."status" = 'active' AND (
		OLD."owner_user_id" IS DISTINCT FROM NEW."owner_user_id"
		OR OLD."session_id" IS DISTINCT FROM NEW."session_id"
		OR OLD."provider" IS DISTINCT FROM NEW."provider"
		OR OLD."purpose" IS DISTINCT FROM NEW."purpose"
		OR OLD."binding_id" IS DISTINCT FROM NEW."binding_id"
		OR OLD."encrypted_secret" IS DISTINCT FROM NEW."encrypted_secret"
		OR OLD."nonce" IS DISTINCT FROM NEW."nonce"
		OR OLD."authentication_tag" IS DISTINCT FROM NEW."authentication_tag"
		OR OLD."encryption_key_version" IS DISTINCT FROM NEW."encryption_key_version"
		OR OLD."secret_last_four" IS DISTINCT FROM NEW."secret_last_four"
		OR OLD."accessible_model_ids" IS DISTINCT FROM NEW."accessible_model_ids"
		OR OLD."model_access_hash" IS DISTINCT FROM NEW."model_access_hash"
		OR OLD."validated_at" IS DISTINCT FROM NEW."validated_at"
		OR OLD."expires_at" IS DISTINCT FROM NEW."expires_at"
	) THEN
		RAISE EXCEPTION 'active AI credential security fields are immutable';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_credentials_lifecycle_guard"
BEFORE UPDATE ON "public"."ai_credentials"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_ai_credential_lifecycle"();
