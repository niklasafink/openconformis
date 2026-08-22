ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_identity_check" CHECK (length(btrim("ai_credentials"."session_id")) > 0
        AND length(btrim("ai_credentials"."binding_id")) > 0
        AND "ai_credentials"."encryption_key_version" > 0
        AND length("ai_credentials"."secret_last_four") = 4
        AND ("ai_credentials"."safe_label" IS NULL OR length("ai_credentials"."safe_label") <= 200)
        AND cardinality("ai_credentials"."accessible_model_ids") = 1
        AND length(btrim("ai_credentials"."accessible_model_ids"[1])) > 0
        AND "ai_credentials"."model_access_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_ttl_check" CHECK ("ai_credentials"."expires_at" > "ai_credentials"."validated_at"
        AND "ai_credentials"."expires_at" <= "ai_credentials"."validated_at" + interval '24 hours');--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_secret_state_check" CHECK ((
          "ai_credentials"."status" = 'active'
          AND "ai_credentials"."encrypted_secret" IS NOT NULL
          AND "ai_credentials"."nonce" IS NOT NULL
          AND "ai_credentials"."authentication_tag" IS NOT NULL
          AND "ai_credentials"."revoked_at" IS NULL
          AND "ai_credentials"."deleted_at" IS NULL
        ) OR (
          "ai_credentials"."status" <> 'active'
          AND "ai_credentials"."encrypted_secret" IS NULL
          AND "ai_credentials"."nonce" IS NULL
          AND "ai_credentials"."authentication_tag" IS NULL
          AND ("ai_credentials"."status" <> 'revoked' OR "ai_credentials"."revoked_at" IS NOT NULL)
          AND ("ai_credentials"."status" NOT IN ('expired', 'deleted') OR "ai_credentials"."deleted_at" IS NOT NULL)
        ));