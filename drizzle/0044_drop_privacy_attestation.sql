ALTER TABLE "ai_credentials" DROP CONSTRAINT "ai_credentials_identity_check";--> statement-breakpoint
ALTER TABLE "ai_credentials" DROP COLUMN "privacy_attestation_accepted";--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_identity_check" CHECK (length(btrim("ai_credentials"."session_id")) > 0
        AND length(btrim("ai_credentials"."binding_id")) > 0
        AND "ai_credentials"."encryption_key_version" > 0
        AND length("ai_credentials"."secret_last_four") = 4
        AND ("ai_credentials"."safe_label" IS NULL OR length("ai_credentials"."safe_label") <= 200)
        AND cardinality("ai_credentials"."accessible_model_ids") = 1
        AND length(btrim("ai_credentials"."accessible_model_ids"[1])) > 0
        AND "ai_credentials"."model_access_hash" ~ '^[0-9a-f]{64}$');
