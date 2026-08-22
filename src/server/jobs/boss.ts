import "server-only";

import { PgBoss } from "pg-boss";

export const documentIngestionQueue = "document-ingestion";
export const documentIngestionDeadLetterQueue = "document-ingestion-dead";
export const documentOcrQueue = "document-ocr";
export const analysisExecutionQueue = "analysis-execution";
export const analysisExecutionDeadLetterQueue = "analysis-execution-dead";

let bossPromise: Promise<PgBoss> | undefined;

function workerDatabaseUrl() {
  const value =
    process.env.WORKER_DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL;

  if (!value) throw new Error("WORKER_DATABASE_URL is not configured.");
  return value;
}

async function startBoss() {
  const boss = new PgBoss({
    connectionString: workerDatabaseUrl(),
    application_name: "conformis-worker",
    monitorIntervalSeconds: 30,
  });
  boss.on("error", (error) => {
    console.error("pg-boss error", { name: error.name });
  });
  await boss.start();
  await boss.createQueue(documentIngestionDeadLetterQueue);
  await boss.createQueue(documentIngestionQueue, {
    retryLimit: 4,
    retryDelay: 30,
    retryBackoff: true,
    deadLetter: documentIngestionDeadLetterQueue,
    warningQueueSize: 100,
  });
  await boss.createQueue(documentOcrQueue, {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    warningQueueSize: 25,
  });
  await boss.createQueue(analysisExecutionDeadLetterQueue);
  await boss.createQueue(analysisExecutionQueue, {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    deadLetter: analysisExecutionDeadLetterQueue,
    warningQueueSize: 50,
  });
  return boss;
}

export function getJobBoss() {
  bossPromise ??= startBoss();
  return bossPromise;
}
