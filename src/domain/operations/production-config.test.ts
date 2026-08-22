import { describe, expect, it } from "vitest";

import { checkProductionConfig } from "./production-config";

function completeEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    APP_ENV: "production",
    CATALOGUE_DRIVER: "database",
    DATABASE_URL: "postgresql://app@database-pooler.example/app?sslmode=require",
    DATABASE_URL_UNPOOLED: "postgresql://migration@database.example/app?sslmode=require",
    WORKER_DATABASE_URL: "postgresql://worker@database.example/app?sslmode=require",
    APP_BUILD_ID: "v0.1.0",
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    NEON_AUTH_BASE_URL: "https://authentication.example.neon.tech",
    NEON_AUTH_COOKIE_SECRET: "a".repeat(32),
    ABUSE_HASH_SECRET: "b".repeat(32),
    STORAGE_DRIVER: "r2",
    R2_JURISDICTION: "eu",
    S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    S3_BUCKET: "conformis-production",
    S3_ACCESS_KEY_ID: "access-key",
    S3_SECRET_ACCESS_KEY: "secret-key",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SITEVERIFY_WORKER_URL: "https://turnstile.example.workers.dev",
    TURNSTILE_ENFORCED: "true",
    WORKER_REQUIRED: "true",
    BYOK_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    WORKER_ID: "worker-fra-1",
    SPONSORED_RUNS_ENABLED: "false",
  };
}

describe("production configuration", () => {
  it("accepts the isolated web and worker configuration", () => {
    expect(checkProductionConfig(completeEnvironment())).toEqual([]);
  });

  it("does not require the migration credential in the web or worker runtime", () => {
    const webEnvironment = completeEnvironment();
    delete webEnvironment.DATABASE_URL_UNPOOLED;
    delete webEnvironment.WORKER_DATABASE_URL;
    delete webEnvironment.WORKER_ID;

    expect(checkProductionConfig(webEnvironment, "web")).toEqual([]);

    const workerEnvironment = completeEnvironment();
    delete workerEnvironment.DATABASE_URL;
    delete workerEnvironment.DATABASE_URL_UNPOOLED;
    delete workerEnvironment.NEON_AUTH_BASE_URL;
    delete workerEnvironment.NEON_AUTH_COOKIE_SECRET;
    delete workerEnvironment.ABUSE_HASH_SECRET;
    delete workerEnvironment.BYOK_ENCRYPTION_KEY;
    delete workerEnvironment.NEXT_PUBLIC_APP_URL;
    delete workerEnvironment.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete workerEnvironment.TURNSTILE_SITEVERIFY_WORKER_URL;

    expect(checkProductionConfig(workerEnvironment, "worker")).toEqual([]);
  });

  it("fails closed on missing protection and storage controls", () => {
    const environment = completeEnvironment();
    environment.TURNSTILE_ENFORCED = "false";
    environment.R2_JURISDICTION = "";
    environment.BYOK_ENCRYPTION_KEY = "not-a-key";

    const variables = checkProductionConfig(environment)
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.variable);

    expect(variables).toEqual(
      expect.arrayContaining(["TURNSTILE_ENFORCED", "R2_JURISDICTION", "BYOK_ENCRYPTION_KEY"]),
    );
  });

  it("requires Neon Auth endpoint and an independent cookie secret for the web runtime", () => {
    const environment = completeEnvironment();
    delete environment.NEON_AUTH_BASE_URL;
    environment.NEON_AUTH_COOKIE_SECRET = "short";

    const variables = checkProductionConfig(environment, "web")
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.variable);

    expect(variables).toEqual(
      expect.arrayContaining(["NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET"]),
    );
  });

  it("rejects reuse of the BYOK encryption key as the Neon Auth cookie secret", () => {
    const environment = completeEnvironment();
    environment.NEON_AUTH_COOKIE_SECRET = environment.BYOK_ENCRYPTION_KEY;

    expect(checkProductionConfig(environment, "web")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variable: "NEON_AUTH_COOKIE_SECRET", severity: "error" }),
      ]),
    );
  });

  it("requires sponsored limits only when sponsorship is enabled", () => {
    const environment = completeEnvironment();
    environment.SPONSORED_RUNS_ENABLED = "true";

    const variables = checkProductionConfig(environment)
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.variable);

    expect(variables).toEqual(
      expect.arrayContaining([
        "SPONSORED_OPENROUTER_API_KEY",
        "SPONSORED_DAILY_RUN_LIMIT",
        "SPONSORED_MAX_CONCURRENCY",
      ]),
    );
  });
});
