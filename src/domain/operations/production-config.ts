export type ProductionRuntimeTarget = "web" | "worker" | "all";

export type ProductionConfigIssue = Readonly<{
  variable: string;
  message: string;
  severity: "error" | "warning";
}>;

function value(environment: NodeJS.ProcessEnv, name: string) {
  return environment[name]?.trim() ?? "";
}

function requireValue(
  issues: ProductionConfigIssue[],
  environment: NodeJS.ProcessEnv,
  name: string,
) {
  if (!value(environment, name)) {
    issues.push({ variable: name, message: "is required", severity: "error" });
  }
}

function requireExact(
  issues: ProductionConfigIssue[],
  environment: NodeJS.ProcessEnv,
  name: string,
  expected: string,
) {
  if (value(environment, name) !== expected) {
    issues.push({
      variable: name,
      message: `must be ${expected}`,
      severity: "error",
    });
  }
}

function requireMinimumLength(
  issues: ProductionConfigIssue[],
  environment: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
) {
  if (value(environment, name).length < minimum) {
    issues.push({
      variable: name,
      message: `must contain at least ${minimum} characters`,
      severity: "error",
    });
  }
}

function requireHttpsUrl(
  issues: ProductionConfigIssue[],
  environment: NodeJS.ProcessEnv,
  name: string,
) {
  const candidate = value(environment, name);
  try {
    if (new URL(candidate).protocol !== "https:") throw new Error("not https");
  } catch {
    issues.push({ variable: name, message: "must be a valid HTTPS URL", severity: "error" });
  }
}

function requirePositiveInteger(
  issues: ProductionConfigIssue[],
  environment: NodeJS.ProcessEnv,
  name: string,
) {
  const parsed = Number.parseInt(value(environment, name), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    issues.push({ variable: name, message: "must be a positive integer", severity: "error" });
  }
}

function validateByokKey(issues: ProductionConfigIssue[], environment: NodeJS.ProcessEnv) {
  const encoded = value(environment, "BYOK_ENCRYPTION_KEY");
  try {
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.byteLength !== 32 || decoded.toString("base64") !== encoded) {
      throw new Error("invalid key");
    }
  } catch {
    issues.push({
      variable: "BYOK_ENCRYPTION_KEY",
      message: "must be exactly 32 random bytes encoded as canonical base64",
      severity: "error",
    });
  }
}

export function checkProductionConfig(
  environment: NodeJS.ProcessEnv,
  target: ProductionRuntimeTarget = "all",
): ProductionConfigIssue[] {
  const issues: ProductionConfigIssue[] = [];
  const includesWeb = target === "web" || target === "all";
  const includesWorker = target === "worker" || target === "all";

  requireExact(issues, environment, "APP_ENV", "production");
  requireExact(issues, environment, "CATALOGUE_DRIVER", "database");
  requireValue(issues, environment, "APP_BUILD_ID");

  if (includesWeb) requireValue(issues, environment, "DATABASE_URL");
  if (target === "all") requireValue(issues, environment, "DATABASE_URL_UNPOOLED");

  if (includesWeb) {
    requireHttpsUrl(issues, environment, "NEXT_PUBLIC_APP_URL");
    requireHttpsUrl(issues, environment, "NEON_AUTH_BASE_URL");
    requireMinimumLength(issues, environment, "NEON_AUTH_COOKIE_SECRET", 32);
    requireMinimumLength(issues, environment, "ABUSE_HASH_SECRET", 32);
    requireExact(issues, environment, "STORAGE_DRIVER", "r2");
    requireExact(issues, environment, "R2_JURISDICTION", "eu");
    for (const name of [
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "TURNSTILE_SITEVERIFY_WORKER_URL",
    ]) {
      requireValue(issues, environment, name);
    }
    requireExact(issues, environment, "TURNSTILE_ENFORCED", "true");
    requireExact(issues, environment, "WORKER_REQUIRED", "true");
    validateByokKey(issues, environment);
    if (
      value(environment, "NEON_AUTH_COOKIE_SECRET") &&
      value(environment, "NEON_AUTH_COOKIE_SECRET") === value(environment, "BYOK_ENCRYPTION_KEY")
    ) {
      issues.push({
        variable: "NEON_AUTH_COOKIE_SECRET",
        message: "must not reuse the BYOK encryption key",
        severity: "error",
      });
    }
  }

  if (includesWorker) {
    requireValue(issues, environment, "WORKER_DATABASE_URL");
    requireValue(issues, environment, "WORKER_ID");
    requireExact(issues, environment, "STORAGE_DRIVER", "r2");
    for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      requireValue(issues, environment, name);
    }
  }

  if (value(environment, "SPONSORED_RUNS_ENABLED") === "true") {
    for (const name of [
      "SPONSORED_OPENROUTER_API_KEY",
      "SPONSORED_OPENROUTER_PROVIDER_ONLY",
      "SPONSORED_ANALYSIS_MODEL",
    ]) {
      requireValue(issues, environment, name);
    }
    requirePositiveInteger(issues, environment, "SPONSORED_DAILY_RUN_LIMIT");
    requirePositiveInteger(issues, environment, "SPONSORED_MAX_CONCURRENCY");
  }

  const databaseUrl = value(environment, "DATABASE_URL");
  const directUrl = value(environment, "DATABASE_URL_UNPOOLED");
  if (databaseUrl && directUrl && databaseUrl === directUrl) {
    issues.push({
      variable: "DATABASE_URL",
      message: "uses the same endpoint as migrations; production web traffic should use a pooler",
      severity: "warning",
    });
  }

  if (value(environment, "MODEL_CATALOGUE_DISCOVERY_DISABLED") === "true") {
    issues.push({
      variable: "MODEL_CATALOGUE_DISCOVERY_DISABLED",
      message: "is enabled; users will only see curated or fallback models",
      severity: "warning",
    });
  }

  return issues;
}
