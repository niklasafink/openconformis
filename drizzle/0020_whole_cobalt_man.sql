ALTER TABLE "analyses" ADD COLUMN "provider_route_allowlist" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_provider_route_check"
CHECK (
  "route_provider" <> 'openrouter'
  OR cardinality("provider_route_allowlist") = 1
);
