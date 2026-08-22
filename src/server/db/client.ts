import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const localDatabaseUrl = "postgresql://conformis:conformis@127.0.0.1:5432/conformis";

const connectionString = process.env.DATABASE_URL ?? localDatabaseUrl;

function maximumClientConnections() {
  const configured = Number.parseInt(process.env.DATABASE_CLIENT_MAX?.trim() || "1", 10);
  if (!Number.isInteger(configured) || configured < 1 || configured > 20) {
    throw new Error("DATABASE_CLIENT_MAX must be an integer between 1 and 20.");
  }
  return configured;
}

type GlobalDatabase = typeof globalThis & {
  conformisPostgresClient?: ReturnType<typeof postgres>;
};

const globalDatabase = globalThis as GlobalDatabase;

export const postgresClient =
  globalDatabase.conformisPostgresClient ??
  postgres(connectionString, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: process.env.NODE_ENV === "production" ? maximumClientConnections() : 1,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.conformisPostgresClient = postgresClient;
}

export const db = drizzle({ client: postgresClient, schema });

export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL);
