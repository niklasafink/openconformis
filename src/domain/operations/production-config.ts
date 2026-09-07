export type ProductionRuntimeTarget = "web" | "all";

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

  requireExact(issues, environment, "APP_ENV", "production");
  requireExact(issues, environment, "CATALOGUE_DRIVER", "database");

  if (includesWeb) requireValue(issues, environment, "DATABASE_URL");
  if (target === "all") requireValue(issues, environment, "DATABASE_URL_UNPOOLED");

  if (includesWeb) {
    requireHttpsUrl(issues, environment, "NEXT_PUBLIC_APP_URL");
    requireHttpsUrl(issues, environment, "NEON_AUTH_BASE_URL");
    requireMinimumLength(issues, environment, "NEON_AUTH_COOKIE_SECRET", 32);
    requireMinimumLength(issues, environment, "ABUSE_HASH_SECRET", 32);
    requireExact(issues, environment, "STORAGE_DRIVER", "vercel-blob");
    requireValue(issues, environment, "BLOB_READ_WRITE_TOKEN");
    requireMinimumLength(issues, environment, "CRON_SECRET", 32);
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
