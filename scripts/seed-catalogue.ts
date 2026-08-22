import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { doraDemoRelease } from "../src/domain/frameworks/dora-demo-release";
import * as schema from "../src/server/db/schema/index";
import { seedRegulatoryCatalogue } from "../src/server/catalogue/seed";

const localDatabaseUrl = "postgresql://conformis:conformis@127.0.0.1:5432/conformis";
const connectionString =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? localDatabaseUrl;
const appEnvironment = process.env.APP_ENV ?? "local";

if (
  appEnvironment === "production" &&
  process.env.CATALOGUE_SEED_PRODUCTION_CONFIRM !== "PUBLISH_DORA_DEMO_RELEASE"
) {
  throw new Error(
    "Production catalogue seeding requires CATALOGUE_SEED_PRODUCTION_CONFIRM=PUBLISH_DORA_DEMO_RELEASE.",
  );
}

const client = postgres(connectionString, {
  max: 1,
  prepare: false,
});
const database = drizzle({ client, schema });

try {
  const report = await seedRegulatoryCatalogue(database, doraDemoRelease);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await client.end();
}
