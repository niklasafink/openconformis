export type CatalogueDriver = "fixture" | "database";

export function resolveCatalogueDriver(
  configuredDriver: string | undefined,
  databaseConfigured: boolean,
): CatalogueDriver {
  const driver = configuredDriver?.trim() || "fixture";

  if (driver !== "fixture" && driver !== "database") {
    throw new Error(`Unsupported CATALOGUE_DRIVER value: ${driver}`);
  }

  if (driver === "database" && !databaseConfigured) {
    throw new Error("CATALOGUE_DRIVER=database requires DATABASE_URL.");
  }

  return driver;
}
