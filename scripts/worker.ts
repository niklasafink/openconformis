import {
  analysisExecutionDeadLetterQueue,
  analysisExecutionQueue,
  documentIngestionQueue,
  documentOcrQueue,
  getJobBoss,
} from "../src/server/jobs/boss";
import { dispatchOutboxBatch } from "../src/server/jobs/outbox-dispatcher";
import { expireTemporaryCredentials } from "../src/server/ai/credential-cleanup";
import { ingestPolicyVersion, type DocumentIngestionJob } from "../src/server/worker/ingest-policy";
import { ocrPolicyVersion, type DocumentOcrJob } from "../src/server/worker/ocr-policy";
import { executeAnalysis, type AnalysisExecutionJob } from "../src/server/worker/execute-analysis";
import { markAnalysisRetriesExhausted } from "../src/server/worker/fail-analysis";
import { purgeExpiredAiData } from "../src/server/maintenance/ai-retention";
import { purgeExpiredPolicyData } from "../src/server/maintenance/policy-retention";
import { recordWorkerHeartbeat } from "../src/server/operations/monitoring";

const boss = await getJobBoss();
let dispatching = false;
let expiringCredentials = false;
let purgingAiData = false;
let purgingPolicyData = false;
const workerId = process.env.WORKER_ID?.trim() || randomUUID();
const workerStartedAt = new Date();
const workerBuildId =
  process.env.APP_BUILD_ID?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "development";

await boss.work<DocumentIngestionJob>(
  documentIngestionQueue,
  { localConcurrency: 2, batchSize: 1, pollingIntervalSeconds: 2 },
  async ([job]) => {
    if (!job) return;
    await ingestPolicyVersion(job.data);
  },
);

await boss.work<DocumentOcrJob>(
  documentOcrQueue,
  { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 2 },
  async ([job]) => {
    if (!job) return;
    await ocrPolicyVersion(job.data);
  },
);

await boss.work<AnalysisExecutionJob>(
  analysisExecutionQueue,
  { localConcurrency: 2, batchSize: 1, pollingIntervalSeconds: 2 },
  async ([job]) => {
    if (!job || job.data.kind !== "analysis_execution") return;
    await executeAnalysis(job.data);
  },
);

await boss.work<AnalysisExecutionJob>(
  analysisExecutionDeadLetterQueue,
  { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 2 },
  async ([job]) => {
    if (!job || job.data.kind !== "analysis_execution") return;
    await markAnalysisRetriesExhausted(job.data.analysisId);
  },
);

async function dispatch() {
  if (dispatching) return;
  dispatching = true;
  try {
    await dispatchOutboxBatch();
  } finally {
    dispatching = false;
  }
}

async function expireCredentials() {
  if (expiringCredentials) return;
  expiringCredentials = true;
  try {
    await expireTemporaryCredentials();
  } finally {
    expiringCredentials = false;
  }
}

async function purgeAiData() {
  if (purgingAiData) return;
  purgingAiData = true;
  try {
    await purgeExpiredAiData();
  } finally {
    purgingAiData = false;
  }
}

async function purgePolicyData() {
  if (purgingPolicyData) return;
  purgingPolicyData = true;
  try {
    await purgeExpiredPolicyData();
  } finally {
    purgingPolicyData = false;
  }
}

async function heartbeat(healthy = true, safeStatus = "running") {
  await recordWorkerHeartbeat({
    workerId,
    buildId: workerBuildId,
    startedAt: workerStartedAt,
    healthy,
    safeStatus,
  });
}

await dispatch();
await expireCredentials();
await purgeAiData();
await purgePolicyData();
await heartbeat();
const timer = setInterval(() => void dispatch(), 1_000);
const credentialExpiryTimer = setInterval(() => void expireCredentials(), 15 * 60 * 1_000);
const aiRetentionTimer = setInterval(() => void purgeAiData(), 60 * 60 * 1_000);
const policyRetentionTimer = setInterval(() => void purgePolicyData(), 60 * 60 * 1_000);
const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);

async function stop() {
  clearInterval(timer);
  clearInterval(credentialExpiryTimer);
  clearInterval(aiRetentionTimer);
  clearInterval(policyRetentionTimer);
  clearInterval(heartbeatTimer);
  await heartbeat(false, "stopping").catch(() => undefined);
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

process.stdout.write("Conformis worker started.\n");
import { randomUUID } from "node:crypto";
