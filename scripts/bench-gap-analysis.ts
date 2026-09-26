/**
 * KPI-Messung der Gap-Analyse mit echten Modellaufrufen gegen die lokale Datenbank.
 *
 * Legt einen Lauf über die ersten N DORA-Anforderungen der Beispiel-Policy an und führt
 * ihn mit dem unveränderten Servercode aus (`prepareAnalysisExecution`,
 * `executeAnalysisScopeItem`, `finalizeAnalysisExecution`). Die Reihenfolge der Schritte
 * entspricht dem Workflow; die Warteschlange von Vercel Workflow fehlt, ihr Anlauf wird
 * separat aus Produktionsläufen berichtet.
 *
 *   BENCH_LABEL=baseline node --env-file=.env.local --conditions=react-server --import tsx scripts/bench-gap-analysis.ts
 *
 * Variablen: BENCH_REQUIREMENTS (5), BENCH_MODEL (openai/gpt-5.6-luna), BENCH_PROFILE
 * (institution), BENCH_CONCURRENCY (8), BENCH_LABEL. Schlüssel: BENCH_OPENROUTER_API_KEY,
 * sonst DEV_OPENROUTER_API_KEY. Die Datenbank ist immer die lokale; eine andere URL wird
 * abgewiesen, damit nie ein Messlauf in Produktion landet.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const localDatabaseUrl = "postgresql://conformis:conformis@127.0.0.1:5432/conformis";
const databaseUrl = process.env.BENCH_DATABASE_URL ?? localDatabaseUrl;
if (!/@(127\.0\.0\.1|localhost)[:/]/u.test(databaseUrl)) {
  throw new Error("BENCH_DATABASE_URL must point at a local database.");
}
process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_URL_UNPOOLED = databaseUrl;
// Wie in Produktion: mehrere Verbindungen, sonst serialisiert der Pool die parallelen Schritte.
process.env.DATABASE_CLIENT_MAX ??= "10";
Object.assign(process.env, { NODE_ENV: "production" });

const apiKey = process.env.BENCH_OPENROUTER_API_KEY ?? process.env.DEV_OPENROUTER_API_KEY;
if (!apiKey) throw new Error("BENCH_OPENROUTER_API_KEY or DEV_OPENROUTER_API_KEY is required.");

const requirementCount = Number.parseInt(process.env.BENCH_REQUIREMENTS ?? "5", 10);
const modelId = process.env.BENCH_MODEL ?? "openai/gpt-5.6-luna";
const profile = (process.env.BENCH_PROFILE ?? "institution") as "auditor" | "institution";
const concurrency = Number.parseInt(process.env.BENCH_CONCURRENCY ?? "8", 10);
const label = process.env.BENCH_LABEL ?? "run";

// Zählt die tatsächlich gesendeten Anbieteranfragen. Eine Zweitanfrage nach
// ANALYSIS_HEDGE_AFTER_SECONDS erscheint nicht im Aufrufprotokoll, nur hier.
const providerRequests = { sent: 0, aborted: 0 };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/chat/completions")) return originalFetch(input, init);
  providerRequests.sent += 1;
  try {
    return await originalFetch(input, init);
  } catch (error) {
    if (init?.signal?.aborted) providerRequests.aborted += 1;
    throw error;
  }
};

const { and, asc, eq, sql } = await import("drizzle-orm");
const { db, postgresClient } = await import("../src/server/db/client");
const schema = await import("../src/server/db/schema");
const { doraDemoRelease } = await import("../src/domain/frameworks/dora-demo-release");
const { createCatalogueItemHash } = await import("../src/domain/frameworks/release-content");
const { createContentHash } = await import("../src/domain/frameworks/content-hash");
const { getActiveAnalysisInstructionSet, conclusionInstructionOf } =
  await import("../src/server/ai/analysis-instruction-service");
const { analysisVerifierModelId, getAnalysisProviderConfiguration } =
  await import("../src/server/ai/provider-routing");
const { activeCredentialEncryptionConfiguration, encryptCredentialSecret } =
  await import("../src/server/security/credential-crypto");
const execution = await import("../src/server/worker/execute-analysis");

const [owner] = await db
  .select({ userId: schema.members.userId, organizationId: schema.members.organizationId })
  .from(schema.members)
  .limit(1);
if (!owner) throw new Error("No local member. Sign in once with LOCAL_AUTH_BYPASS first.");

const [policyVersion] = await db
  .select({
    id: schema.policyVersions.id,
    sha256: schema.policyVersions.sha256,
    parserVersion: schema.policyVersions.parserVersion,
  })
  .from(schema.policyVersions)
  .innerJoin(schema.policies, eq(schema.policies.id, schema.policyVersions.policyId))
  .where(
    and(
      eq(schema.policies.displayName, "beispiel-ikt-sicherheitsrichtlinie"),
      eq(schema.policyVersions.parseStatus, "ready"),
    ),
  )
  .limit(1);
if (!policyVersion?.sha256 || !policyVersion.parserVersion) {
  throw new Error("The sample policy is not ingested in the local database.");
}

// Ohne das käme jede Bewertung ab dem zweiten Lauf aus dem Cache und die Messung wäre wertlos.
await db
  .delete(schema.analysisAssessmentCache)
  .where(eq(schema.analysisAssessmentCache.organizationId, owner.organizationId));

const provider = getAnalysisProviderConfiguration("openrouter");
const verifierModelId = analysisVerifierModelId("openrouter", modelId);
const instructions = await getActiveAnalysisInstructionSet();
const conclusionInstruction = conclusionInstructionOf(instructions, profile);
const requirements = [...doraDemoRelease.requirements]
  .sort((left, right) => left.displayOrder - right.displayOrder)
  .slice(0, requirementCount);

const [draft] = await db
  .insert(schema.anonymousDrafts)
  .values({
    bindingHash: `bench-${randomUUID()}`,
    status: "claimed",
    frameworkSlug: doraDemoRelease.framework.slug,
    claimedByUserId: owner.userId,
    claimedAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  })
  .returning({ id: schema.anonymousDrafts.id });
if (!draft) throw new Error("DRAFT_NOT_CREATED");

const credentialId = randomUUID();
const sessionId = `bench-${randomUUID()}`;
const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);
const encryption = activeCredentialEncryptionConfiguration();
const encrypted = encryptCredentialSecret({
  secret: apiKey,
  binding: {
    credentialId,
    ownerUserId: owner.userId,
    sessionId,
    provider: "openrouter",
    purpose: "analysis",
    bindingId: draft.id,
    expiresAt: expiresAt.toISOString(),
  },
  encodedKey: encryption.encodedKey,
  keyVersion: encryption.keyVersion,
});
// Der Schlüssel ist an genau ein Modell gebunden; die Verifikation läuft über denselben.
const accessibleModelIds = [modelId];
await db.insert(schema.aiCredentials).values({
  id: credentialId,
  ownerUserId: owner.userId,
  sessionId,
  provider: "openrouter",
  purpose: "analysis",
  bindingId: draft.id,
  encryptedSecret: encrypted.ciphertext,
  nonce: encrypted.nonce,
  authenticationTag: encrypted.authenticationTag,
  encryptionKeyVersion: encrypted.keyVersion,
  secretLastFour: apiKey.slice(-4),
  accessibleModelIds,
  modelAccessHash: createContentHash(accessibleModelIds),
  validatedAt: new Date(),
  expiresAt,
});

const startedAt = new Date();
const [analysis] = await db
  .insert(schema.analyses)
  .values({
    organizationId: owner.organizationId,
    ownerUserId: owner.userId,
    sourceDraftId: draft.id,
    policyVersionId: policyVersion.id,
    aiCredentialId: credentialId,
    frameworkSlug: doraDemoRelease.framework.slug,
    frameworkReleaseKey: doraDemoRelease.release.version,
    frameworkContentHash: createContentHash(doraDemoRelease),
    institutionSize: "medium",
    analysisProfile: profile,
    locale: "de",
    status: "running",
    stage: "retrieval",
    routeProvider: "openrouter",
    providerModelId: modelId,
    modelProfileId: `openrouter:${modelId}`,
    verifierProviderModelId: verifierModelId,
    verifierModelProfileId: `openrouter:${verifierModelId}`,
    modelCatalogueVersion: "bench",
    privacyProfileId: provider.privacyProfileId,
    promptVersion: instructions.assessment.version,
    verifierPromptVersion: instructions.verification.version,
    assessmentInstructionId: instructions.assessment.id,
    assessmentInstructionHash: instructions.assessment.contentHash,
    verificationInstructionId: instructions.verification.id,
    verificationInstructionHash: instructions.verification.contentHash,
    conclusionPromptVersion: conclusionInstruction.version,
    conclusionInstructionId: conclusionInstruction.id,
    conclusionInstructionHash: conclusionInstruction.contentHash,
    configurationHash: createContentHash({ bench: randomUUID() }),
    policySha256: policyVersion.sha256,
    policyParserVersion: policyVersion.parserVersion,
    requirementCount: requirements.length,
    unevaluatedWarningAccepted: true,
    startedAt,
  })
  .returning({ id: schema.analyses.id });
if (!analysis) throw new Error("ANALYSIS_NOT_CREATED");

await db.insert(schema.analysisScopeItems).values(
  requirements.map((requirement) => ({
    analysisId: analysis.id,
    requirementExternalKey: requirement.externalKey,
    regulatoryId: requirement.regulatoryId,
    title: requirement.title,
    legalText: requirement.legalText,
    assessmentAspects: requirement.assessmentAspects,
    sourceLocator: requirement.sourceLocator,
    sizeGuidance: requirement.sizeGuidance.medium,
    subrequirements: requirement.subrequirements.map((subrequirement) => ({
      externalKey: subrequirement.externalKey,
      regulatoryId: subrequirement.regulatoryId,
      title: subrequirement.title,
      legalText: subrequirement.legalText,
      assessmentAspects: subrequirement.assessmentAspects,
      sourceLocator: subrequirement.sourceLocator,
      sizeGuidance: subrequirement.sizeGuidance.medium,
      displayOrder: subrequirement.displayOrder,
    })),
    displayOrder: requirement.displayOrder,
    contentHash: createCatalogueItemHash(requirement),
  })),
);

const flags = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    /^(ANALYSIS_|OPENROUTER_PROVIDER|BYOK_REASONING|BYOK_MAX_OUTPUT)/u.test(name),
  ),
);
process.stdout.write(
  `${label}: ${requirements.length} requirements, ${modelId}, verifier ${verifierModelId}, ${JSON.stringify(flags)}\n`,
);

/** Die Planung des Workflows, ohne dessen Warteschlange: ein fortlaufender Pool. */
async function runPool(ids: string[], limit: number) {
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const index = next++;
      const scopeItemId = ids[index]!;
      await execution.executeAnalysisScopeItem({
        analysisId: analysis!.id,
        scopeItemId,
        index,
        total: ids.length,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
}

let failure: unknown;
try {
  const prepared = await execution.prepareAnalysisExecution(analysis.id, `bench-${randomUUID()}`);
  if (prepared.status !== "running") throw new Error(`PREPARE_${prepared.status}`);
  await runPool(prepared.scopeItemIds, concurrency);
  await execution.finalizeAnalysisExecution(analysis.id);
} catch (error) {
  failure = error;
}
const finishedAt = new Date();

const seconds = (value: Date | null | undefined) =>
  value ? Math.round((value.getTime() - startedAt.getTime()) / 100) / 10 : null;

const items = await db
  .select({
    scopeItemId: schema.analysisScopeItems.id,
    regulatoryId: schema.analysisScopeItems.regulatoryId,
    status: schema.analysisRequirementResults.status,
    verification: schema.analysisRequirementResults.verificationStatus,
    resultAt: schema.analysisRequirementResults.createdAt,
    conclusionAt: schema.analysisRequirementConclusions.createdAt,
    evidence: sql<number>`(select count(*)::integer from analysis_evidence e where e.result_id = ${schema.analysisRequirementResults.id})`,
  })
  .from(schema.analysisScopeItems)
  .leftJoin(
    schema.analysisRequirementResults,
    eq(schema.analysisRequirementResults.scopeItemId, schema.analysisScopeItems.id),
  )
  .leftJoin(
    schema.analysisRequirementConclusions,
    eq(schema.analysisRequirementConclusions.resultId, schema.analysisRequirementResults.id),
  )
  .where(eq(schema.analysisScopeItems.analysisId, analysis.id))
  .orderBy(asc(schema.analysisScopeItems.displayOrder));

const invocations = await db
  .select({
    scopeItemId: schema.analysisModelInvocations.scopeItemId,
    stage: schema.analysisModelInvocations.invocationStage,
    status: schema.analysisModelInvocations.status,
    modelId: schema.analysisModelInvocations.modelId,
    latency: schema.analysisModelInvocations.latencyMilliseconds,
    outputTokens: schema.analysisModelInvocations.outputTokens,
    reasoningTokens: schema.analysisModelInvocations.reasoningTokens,
    cost: schema.analysisModelInvocations.costMicrounits,
    startedAt: schema.analysisModelInvocations.startedAt,
    completedAt: schema.analysisModelInvocations.completedAt,
  })
  .from(schema.analysisModelInvocations)
  .where(eq(schema.analysisModelInvocations.analysisId, analysis.id))
  .orderBy(asc(schema.analysisModelInvocations.startedAt));

const rows = items.map((item) => {
  const calls = invocations.filter(({ scopeItemId }) => scopeItemId === item.scopeItemId);
  // Heute lädt die Seite erst nach, wenn der Fortschritt steigt — und der steigt erst
  // nach dem Abschlusstext. Sichtbar ist ein Ergebnis also erst mit beiden.
  const complete =
    item.resultAt && item.conclusionAt
      ? new Date(Math.max(item.resultAt.getTime(), item.conclusionAt.getTime()))
      : item.resultAt;
  return {
    id: item.regulatoryId,
    status: item.status,
    verification: item.verification,
    evidence: item.evidence,
    resultS: seconds(item.resultAt),
    completeS: seconds(complete),
    calls: calls.map(
      (call) =>
        `${call.stage.replace("_attempt_", "#")}${call.status === "failed" ? "!" : ""}:${
          call.latency === null ? "?" : Math.round(call.latency / 100) / 10
        }s`,
    ),
  };
});

const numbers = (values: (number | null)[]) =>
  values.filter((value): value is number => value !== null);
const resultTimes = numbers(rows.map(({ resultS }) => resultS));
const completeTimes = numbers(rows.map(({ completeS }) => completeS));
const summary = {
  label,
  model: modelId,
  requirements: requirements.length,
  failed: failure ? String(failure instanceof Error ? failure.message : failure) : undefined,
  firstResultS: resultTimes.length ? Math.min(...resultTimes) : null,
  firstCompleteS: completeTimes.length ? Math.min(...completeTimes) : null,
  allResultsS: resultTimes.length === rows.length ? Math.max(...resultTimes) : null,
  allCompleteS: completeTimes.length === rows.length ? Math.max(...completeTimes) : null,
  wallS: seconds(finishedAt),
  modelCalls: invocations.length,
  providerRequests: providerRequests.sent,
  hedgedAborted: providerRequests.aborted,
  failedCalls: invocations.filter(({ status }) => status === "failed").length,
  costUsd: Math.round(invocations.reduce((sum, { cost }) => sum + (cost ?? 0), 0) / 1_000) / 1_000,
};

console.table(rows);
console.log(JSON.stringify(summary, null, 2));

const directory = resolve(process.cwd(), "scripts/.bench-results");
await mkdir(directory, { recursive: true });
await writeFile(
  resolve(directory, `${new Date().toISOString().replace(/[:.]/gu, "-")}-${label}.json`),
  JSON.stringify({ summary, flags, rows, invocations, analysisId: analysis.id }, null, 2),
);
await postgresClient.end();
if (failure) process.exitCode = 1;
