import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  evaluateMandatoryModelThresholds,
  modelEvaluationMetricsSchema,
} from "@/domain/ai/evaluation";
import { aiRouteProviderSchema } from "@/domain/ai/provider";
import { appendAuditEvent } from "@/server/audit/event";
import { requireCatalogueAdministrator } from "@/server/catalogue/administrator";
import { db } from "@/server/db/client";
import { aiModelEvaluations, aiModelProfiles } from "@/server/db/schema/ai";

export const publishModelEvaluationSchema = z
  .object({
    profile: z.object({
      id: z.string().trim().min(3).max(300),
      publisher: z.string().trim().min(1).max(120),
      displayName: z.string().trim().min(1).max(200),
      routeProvider: aiRouteProviderSchema,
      providerModelId: z.string().trim().min(1).max(300),
      tasks: z.array(z.enum(["gap_analysis", "verification", "chat"])).min(1),
      supportsStructuredOutput: z.boolean(),
      supportsStreaming: z.boolean(),
      contextWindow: z.number().int().positive().optional(),
      privacyProfileId: z.string().trim().min(1).max(100),
    }),
    evaluationVersion: z.string().trim().min(1).max(100),
    datasetHash: z.string().regex(/^[0-9a-f]{64}$/u),
    promptVersion: z.string().trim().min(1).max(100),
    recommendation: z.enum(["quality", "balanced", "economy"]).nullable(),
    publish: z.boolean(),
    evaluatedAt: z.coerce.date(),
    metrics: modelEvaluationMetricsSchema,
  })
  .strict();

export async function saveModelEvaluation(input: z.infer<typeof publishModelEvaluationSchema>) {
  const [principal, parsed] = await Promise.all([
    requireCatalogueAdministrator(),
    Promise.resolve(publishModelEvaluationSchema.parse(input)),
  ]);
  const passed = evaluateMandatoryModelThresholds(parsed.metrics);
  if (parsed.publish && !passed) throw new Error("MODEL_EVALUATION_THRESHOLDS_FAILED");
  if (parsed.recommendation && (!parsed.publish || !passed)) {
    throw new Error("MODEL_RECOMMENDATION_REQUIRES_CERTIFICATION");
  }

  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${parsed.profile.id}, 0))`,
    );
    const [existingEvaluation] = await transaction
      .select({ status: aiModelEvaluations.status })
      .from(aiModelEvaluations)
      .where(
        and(
          eq(aiModelEvaluations.modelProfileId, parsed.profile.id),
          eq(aiModelEvaluations.evaluationVersion, parsed.evaluationVersion),
        ),
      )
      .limit(1);
    if (existingEvaluation?.status === "published") {
      throw new Error("MODEL_EVALUATION_IMMUTABLE");
    }
    await transaction
      .insert(aiModelProfiles)
      .values({
        ...parsed.profile,
        lifecycle: parsed.publish ? "certified" : "candidate",
        recommendation: parsed.recommendation,
        evaluationVersion: parsed.publish ? parsed.evaluationVersion : null,
      })
      .onConflictDoUpdate({
        target: aiModelProfiles.id,
        set: {
          publisher: parsed.profile.publisher,
          displayName: parsed.profile.displayName,
          routeProvider: parsed.profile.routeProvider,
          providerModelId: parsed.profile.providerModelId,
          tasks: parsed.profile.tasks,
          lifecycle: parsed.publish ? "certified" : "candidate",
          recommendation: parsed.recommendation,
          supportsStructuredOutput: parsed.profile.supportsStructuredOutput,
          supportsStreaming: parsed.profile.supportsStreaming,
          contextWindow: parsed.profile.contextWindow,
          privacyProfileId: parsed.profile.privacyProfileId,
          evaluationVersion: parsed.publish ? parsed.evaluationVersion : null,
          updatedAt: new Date(),
        },
      });

    const [evaluation] = await transaction
      .insert(aiModelEvaluations)
      .values({
        modelProfileId: parsed.profile.id,
        evaluationVersion: parsed.evaluationVersion,
        datasetHash: parsed.datasetHash,
        promptVersion: parsed.promptVersion,
        ...parsed.metrics,
        mandatoryThresholdsPassed: passed,
        status: parsed.publish ? "published" : "draft",
        metrics: parsed.metrics,
        createdByUserId: principal.userId,
        publishedByUserId: parsed.publish ? principal.userId : null,
        evaluatedAt: parsed.evaluatedAt,
        publishedAt: parsed.publish ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [aiModelEvaluations.modelProfileId, aiModelEvaluations.evaluationVersion],
        set: {
          ...parsed.metrics,
          mandatoryThresholdsPassed: passed,
          status: parsed.publish ? "published" : "draft",
          metrics: parsed.metrics,
          publishedByUserId: parsed.publish ? principal.userId : null,
          publishedAt: parsed.publish ? new Date() : null,
        },
      })
      .returning({ id: aiModelEvaluations.id });
    if (!evaluation) throw new Error("MODEL_EVALUATION_NOT_SAVED");

    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: parsed.publish ? "ai_model.certified" : "ai_model.evaluation_saved",
      targetType: "ai_model_profile",
      targetId: parsed.profile.id,
      metadata: {
        evaluationVersion: parsed.evaluationVersion,
        mandatoryThresholdsPassed: passed,
        recommendation: parsed.recommendation,
      },
    });
    return { evaluationId: evaluation.id, certified: parsed.publish, passed };
  });
}

export async function listModelEvaluations() {
  await requireCatalogueAdministrator();
  return db
    .select({
      profileId: aiModelProfiles.id,
      publisher: aiModelProfiles.publisher,
      displayName: aiModelProfiles.displayName,
      routeProvider: aiModelProfiles.routeProvider,
      providerModelId: aiModelProfiles.providerModelId,
      lifecycle: aiModelProfiles.lifecycle,
      recommendation: aiModelProfiles.recommendation,
      evaluationVersion: aiModelEvaluations.evaluationVersion,
      mandatoryThresholdsPassed: aiModelEvaluations.mandatoryThresholdsPassed,
      status: aiModelEvaluations.status,
      evaluatedAt: aiModelEvaluations.evaluatedAt,
      publishedAt: aiModelEvaluations.publishedAt,
    })
    .from(aiModelProfiles)
    .leftJoin(aiModelEvaluations, eq(aiModelEvaluations.modelProfileId, aiModelProfiles.id));
}

const lifecycleUpdateSchema = z
  .object({
    profileId: z.string().trim().min(3).max(300),
    lifecycle: z.enum(["candidate", "deprecated", "blocked"]),
  })
  .strict();

export async function updateModelLifecycle(input: z.infer<typeof lifecycleUpdateSchema>) {
  const [principal, parsed] = await Promise.all([
    requireCatalogueAdministrator(),
    Promise.resolve(lifecycleUpdateSchema.parse(input)),
  ]);
  return db.transaction(async (transaction) => {
    const [profile] = await transaction
      .update(aiModelProfiles)
      .set({
        lifecycle: parsed.lifecycle,
        recommendation: null,
        evaluationVersion: parsed.lifecycle === "candidate" ? null : undefined,
        updatedAt: new Date(),
      })
      .where(eq(aiModelProfiles.id, parsed.profileId))
      .returning({ id: aiModelProfiles.id, lifecycle: aiModelProfiles.lifecycle });
    if (!profile) throw new Error("MODEL_PROFILE_NOT_FOUND");
    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "ai_model.lifecycle_changed",
      targetType: "ai_model_profile",
      targetId: profile.id,
      metadata: { lifecycle: profile.lifecycle },
    });
    return profile;
  });
}
