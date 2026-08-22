import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set before running migrations.");
}

const client = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  onnotice: () => undefined,
});

try {
  await migrate(drizzle(client), {
    migrationsFolder: resolve(process.cwd(), "drizzle"),
    migrationsSchema: "drizzle",
    migrationsTable: "__drizzle_migrations",
  });

  console.log("Database migrations completed.");
} finally {
  await client.end({ timeout: 5 });
}
