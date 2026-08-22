import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createContentHash } from "@/domain/frameworks/content-hash";
import { appendAuditEvent } from "@/server/audit/event";
import { requireCatalogueAdministrator } from "@/server/catalogue/administrator";
import { db } from "@/server/db/client";
import { analysisInstructions } from "@/server/db/schema/ai";

export const defaultAssessmentInstruction =
  "Bewerte jede regulatorische Pflicht konservativ und einzeln. Eine Anforderung ist nur erfüllt, wenn alle verpflichtenden Prüfaspekte durch belastbare Policy-Belege gestützt werden. Weise Unsicherheit und fehlende Informationen ausdrücklich aus.";

export const defaultVerificationInstruction =
  "Prüfe Status, Begründung und jede Belegzuordnung unabhängig. Lehne optimistische Bewertungen, nicht belegte Aussagen, unvollständige Pflichtaspekte und widersprüchliche Belege ab. Wähle bei verbleibender Unsicherheit keine günstigere Bewertung.";

export const analysisInstructionInputSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["assessment", "verification"]),
  version: z.string().trim().min(1).max(100),
  instruction: z.string().trim().min(40).max(20_000),
});

export const analysisInstructionActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["publish", "archive"]),
});

export type FrozenAnalysisInstruction = {
  id?: string;
  kind: "assessment" | "verification";
  version: string;
  instruction: string;
  contentHash: string;
};

function builtInInstruction(kind: "assessment" | "verification"): FrozenAnalysisInstruction {
  const instruction =
    kind === "assessment" ? defaultAssessmentInstruction : defaultVerificationInstruction;
  const version = kind === "assessment" ? "gap-analysis-v1" : "gap-verification-v1";
  return {
    kind,
    version,
    instruction,
    contentHash: createContentHash({ kind, version, instruction }),
  };
}

export async function getActiveAnalysisInstruction(
  kind: "assessment" | "verification",
): Promise<FrozenAnalysisInstruction> {
  const [record] = await db
    .select()
    .from(analysisInstructions)
    .where(and(eq(analysisInstructions.kind, kind), eq(analysisInstructions.status, "published")))
    .orderBy(desc(analysisInstructions.publishedAt))
    .limit(1);

  return record
    ? {
        id: record.id,
        kind: record.kind,
        version: record.version,
        instruction: record.instruction,
        contentHash: record.contentHash,
      }
    : builtInInstruction(kind);
}

export async function getActiveAnalysisInstructionPair() {
  const [assessment, verification] = await Promise.all([
    getActiveAnalysisInstruction("assessment"),
    getActiveAnalysisInstruction("verification"),
  ]);
  return { assessment, verification };
}

export async function getFrozenAnalysisInstruction(input: {
  id: string | null;
  kind: "assessment" | "verification";
  version: string;
  contentHash: string | null;
}) {
  if (!input.id) {
    const fallback = builtInInstruction(input.kind);
    if (fallback.version !== input.version) throw new Error("FROZEN_INSTRUCTION_NOT_FOUND");
    return fallback;
  }

  const [record] = await db
    .select()
    .from(analysisInstructions)
    .where(and(eq(analysisInstructions.id, input.id), eq(analysisInstructions.kind, input.kind)))
    .limit(1);
  if (
    !record ||
    record.version !== input.version ||
    !input.contentHash ||
    record.contentHash !== input.contentHash
  ) {
    throw new Error("FROZEN_INSTRUCTION_MISMATCH");
  }
  return record;
}

export async function listAnalysisInstructions() {
  await requireCatalogueAdministrator();
  return db
    .select({
      id: analysisInstructions.id,
      kind: analysisInstructions.kind,
      version: analysisInstructions.version,
      status: analysisInstructions.status,
      instruction: analysisInstructions.instruction,
      contentHash: analysisInstructions.contentHash,
      publishedAt: analysisInstructions.publishedAt,
      updatedAt: analysisInstructions.updatedAt,
    })
    .from(analysisInstructions)
    .orderBy(analysisInstructions.kind, desc(analysisInstructions.createdAt));
}

export async function saveAnalysisInstruction(unvalidatedInput: unknown) {
  const [principal, input] = await Promise.all([
    requireCatalogueAdministrator(),
    Promise.resolve(analysisInstructionInputSchema.parse(unvalidatedInput)),
  ]);
  const contentHash = createContentHash({
    kind: input.kind,
    version: input.version,
    instruction: input.instruction,
  });

  return db.transaction(async (transaction) => {
    if (input.id) {
      const [saved] = await transaction
        .update(analysisInstructions)
        .set({
          version: input.version,
          instruction: input.instruction,
          contentHash,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(analysisInstructions.id, input.id),
            eq(analysisInstructions.kind, input.kind),
            eq(analysisInstructions.status, "draft"),
          ),
        )
        .returning({ id: analysisInstructions.id });
      if (!saved) throw new Error("INSTRUCTION_DRAFT_REQUIRED");
      await appendAuditEvent(transaction, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: "ai.instruction_updated",
        targetType: "analysis_instruction",
        targetId: saved.id,
        metadata: { kind: input.kind, version: input.version, contentHash },
      });
      return saved;
    }

    const [saved] = await transaction
      .insert(analysisInstructions)
      .values({
        kind: input.kind,
        version: input.version,
        instruction: input.instruction,
        contentHash,
        createdByUserId: principal.userId,
      })
      .returning({ id: analysisInstructions.id });
    if (!saved) throw new Error("INSTRUCTION_NOT_CREATED");
    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "ai.instruction_created",
      targetType: "analysis_instruction",
      targetId: saved.id,
      metadata: { kind: input.kind, version: input.version, contentHash },
    });
    return saved;
  });
}

export async function updateAnalysisInstructionStatus(unvalidatedInput: unknown) {
  const [principal, input] = await Promise.all([
    requireCatalogueAdministrator(),
    Promise.resolve(analysisInstructionActionSchema.parse(unvalidatedInput)),
  ]);
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select id from analysis_instructions where id = ${input.id} for update`,
    );
    const [record] = await transaction
      .select({ kind: analysisInstructions.kind, status: analysisInstructions.status })
      .from(analysisInstructions)
      .where(eq(analysisInstructions.id, input.id))
      .limit(1);
    if (!record) throw new Error("INSTRUCTION_NOT_FOUND");

    const now = new Date();
    if (input.action === "publish") {
      if (record.status !== "draft") throw new Error("INSTRUCTION_DRAFT_REQUIRED");
      await transaction
        .update(analysisInstructions)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(analysisInstructions.kind, record.kind),
            eq(analysisInstructions.status, "published"),
          ),
        );
      await transaction
        .update(analysisInstructions)
        .set({
          status: "published",
          publishedAt: now,
          publishedByUserId: principal.userId,
          updatedAt: now,
        })
        .where(eq(analysisInstructions.id, input.id));
    } else {
      if (record.status !== "published") throw new Error("INSTRUCTION_PUBLISHED_REQUIRED");
      await transaction
        .update(analysisInstructions)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(eq(analysisInstructions.id, input.id));
    }

    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: `ai.instruction_${input.action === "publish" ? "published" : "archived"}`,
      targetType: "analysis_instruction",
      targetId: input.id,
      metadata: { kind: record.kind },
    });
    return { id: input.id, status: input.action === "publish" ? "published" : "archived" };
  });
}
