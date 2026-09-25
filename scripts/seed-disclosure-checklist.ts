/**
 * Legt die Demo-Vorlage der Vollständigkeitsprüfung an und veröffentlicht sie:
 * „HGB-Anhang und Lagebericht Kapitalgesellschaft (Demo)“. Idempotent — eine
 * Wiederholung mit gleichem Inhalt ändert nichts, geänderter Inhalt wird eine neue Version.
 *
 *   pnpm disclosure:seed-checklist:local   # lokale Datenbank
 *   pnpm disclosure:seed-checklist         # Datenbank aus .env.local (Produktion)
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/server/db/schema/index";
import { seedDemoChecklistTemplate } from "../src/server/disclosure/checklist-store";

const localDatabaseUrl = "postgresql://conformis:conformis@127.0.0.1:5432/conformis";
const connectionString =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? localDatabaseUrl;

const client = postgres(connectionString, { max: 1, prepare: false });
const database = drizzle({ client, schema });

try {
  const report = await seedDemoChecklistTemplate(database);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await client.end();
}
