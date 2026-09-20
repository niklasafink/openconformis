import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { systemOneModelId } from "@/domain/ai/system-one";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { defaultCitationAcceptThresholdBp } from "@/domain/review/citation";
import { reviewPromptVersion } from "@/domain/review/model-answer";
import { appendAuditEvent } from "@/server/audit/event";
import { deleteTemporaryCredential } from "@/server/ai/credential-cleanup";
import { resolveAnalysisModelSelection } from "@/server/ai/model-catalogue";
import { getAnalysisProviderConfiguration } from "@/server/ai/provider-routing";
import {
  createReviewRunCredential,
  TemporaryCredentialError,
} from "@/server/ai/temporary-credential-service";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { policyVersions } from "@/server/db/schema/documents";
import {
  reviewCells,
  reviewColumns,
  reviewDocuments,
  reviewRunColumns,
  reviewRunDocuments,
  reviewRuns,
  reviewTables,
} from "@/server/db/schema/reviews";
import { reviewDecisionEngine } from "@/server/environment";
import { launchReviewWorkflow } from "@/server/workflows/launch";

import { resolveReviewActor, requireManagement } from "./review-actor";
import { maximumReviewCells, maximumReviewDocuments } from "./review-limits";

export class ReviewStartError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ReviewStartError";
  }
}

export { maximumReviewCells, maximumReviewDocuments };

/** Konservativ, weil TypeSafe Deutsch ausdrücklich schwächer nennt als Englisch. */
export const defaultEscalationThresholdBp = 7_500;
const credentialSafetyMarginMilliseconds = 5 * 60_000;

export const reviewStartInputSchema = z.object({
  reviewTableId: z.uuid(),
  /** Das grosse Modell: Eskalation im Jev-Modus, alle Zellen im Modellmodus. */
  modelProfileId: z.string().trim().min(1).max(300),
  modelCatalogueVersion: z.string().trim().min(1).max(128),
  /** Ohne Angabe nutzt der Server den gespeicherten Schlüssel des Nutzers je Anbieter. */
  escalationApiKey: z.string().trim().min(8).max(20_000).optional(),
  /** TypeSafe-Schlüssel; im Modus `model` nicht gebraucht. */
  routingApiKey: z.string().trim().min(8).max(20_000).optional(),
  escalationThresholdBp: z.number().int().min(5_000).max(9_500).optional(),
  escalationBudgetCells: z.number().int().min(0).max(maximumReviewCells).optional(),
});

export type ReviewStartInput = z.infer<typeof reviewStartInputSchema>;

export type StartReviewResult = {
  reviewRunId: string;
  status: "queued" | "running" | "completed" | "completed_with_gaps" | "failed" | "cancelled";
  reused: boolean;
};

type Credential = { credentialId: string; expiresAt: string };

async function connect(
  input: Parameters<typeof createReviewRunCredential>[0],
  missingKeyCode: string,
): Promise<Credential> {
  try {
    return await createReviewRunCredential(input);
  } catch (error) {
    if (
      error instanceof TemporaryCredentialError &&
      error.code === "BYOK_SAVED_CREDENTIAL_NOT_FOUND"
    ) {
      throw new ReviewStartError(missingKeyCode);
    }
    throw error;
  }
}

/**
 * Friert eine Vertragsprüfung ein und startet sie: Dokumentmenge, Spaltenmenge, Engine,
 * Schwellwerte, Budget und Modellroute. Jeder Lauf läuft über die eigenen, kurzlebig
 * abgeleiteten Schlüssel des Nutzers — einen Betreiber-Schlüssel gibt es nicht.
 *
 * Idempotent: ein doppelt abgeschickter Start übernimmt den offenen Lauf der Tabelle,
 * statt einen zweiten anzulegen.
 */
export async function startReview(untrustedInput: ReviewStartInput): Promise<StartReviewResult> {
  const input = reviewStartInputSchema.parse(untrustedInput);
  if (!isDatabaseConfigured) throw new ReviewStartError("DATABASE_UNAVAILABLE");

  const actor = requireManagement(await resolveReviewActor());

  const [table] = await db
    .select()
    .from(reviewTables)
    .where(
      and(
        eq(reviewTables.id, input.reviewTableId),
        eq(reviewTables.organizationId, actor.organizationId),
        isNull(reviewTables.archivedAt),
      ),
    )
    .limit(1);
  if (!table) throw new ReviewStartError("REVIEW_TABLE_NOT_FOUND");

  // Ein doppelter Klick oder eine verlorene Antwort: der offene Lauf gilt weiter.
  const earlier = await findOpenRun(db, table.id);
  if (earlier) return launchPending(earlier, true);

  const engine = (() => {
    try {
      return reviewDecisionEngine();
    } catch {
      throw new ReviewStartError("REVIEW_ENGINE_INVALID");
    }
  })();

  const [documents, columns] = await Promise.all([
    db
      .select({
        id: reviewDocuments.id,
        ordinal: reviewDocuments.ordinal,
        displayName: reviewDocuments.displayName,
        policyVersionId: reviewDocuments.policyVersionId,
        parseStatus: policyVersions.parseStatus,
        sha256: policyVersions.sha256,
        parserVersion: policyVersions.parserVersion,
      })
      .from(reviewDocuments)
      .innerJoin(policyVersions, eq(policyVersions.id, reviewDocuments.policyVersionId))
      .where(eq(reviewDocuments.reviewTableId, table.id))
      .orderBy(asc(reviewDocuments.ordinal)),
    db
      .select()
      .from(reviewColumns)
      .where(and(eq(reviewColumns.reviewTableId, table.id), isNull(reviewColumns.archivedAt)))
      .orderBy(asc(reviewColumns.ordinal)),
  ]);
  if (documents.length === 0) throw new ReviewStartError("REVIEW_NO_DOCUMENTS");
  if (columns.length === 0) throw new ReviewStartError("REVIEW_NO_COLUMNS");
  if (documents.length > maximumReviewDocuments) throw new ReviewStartError("REVIEW_TOO_LARGE");
  const cellCount = documents.length * columns.length;
  if (cellCount > maximumReviewCells) throw new ReviewStartError("REVIEW_TOO_LARGE");
  if (
    documents.some(
      (document) => document.parseStatus !== "ready" || !document.sha256 || !document.parserVersion,
    )
  ) {
    throw new ReviewStartError("REVIEW_DOCUMENT_NOT_READY");
  }

  const { model, catalogue } = await resolveAnalysisModelSelection({
    modelProfileId: input.modelProfileId,
    catalogueVersion: input.modelCatalogueVersion,
  }).catch(() => {
    throw new ReviewStartError("MODEL_SELECTION_NOT_FOUND");
  });
  let provider;
  try {
    provider = getAnalysisProviderConfiguration(model.routeProvider);
  } catch {
    throw new ReviewStartError("BYOK_ROUTE_NOT_EXECUTABLE");
  }

  const reviewRunId = randomUUID();
  const escalationThresholdBp = input.escalationThresholdBp ?? defaultEscalationThresholdBp;
  const escalationBudgetCells =
    input.escalationBudgetCells ?? Math.min(cellCount, Math.max(10, Math.ceil(cellCount * 0.25)));
  const documentSetHash = createContentHash(
    documents.map((document) => ({
      ordinal: document.ordinal,
      sha256: document.sha256,
      parserVersion: document.parserVersion,
    })),
  );
  const columnSetHash = createContentHash(
    columns.map((column) => ({ ordinal: column.ordinal, contentHash: column.contentHash })),
  );
  const configurationHash = createContentHash({
    engine,
    documentSetHash,
    columnSetHash,
    routingProvider: engine === "jev" ? "typesafe" : model.routeProvider,
    jevModelId: engine === "jev" ? systemOneModelId : null,
    escalationProvider: model.routeProvider,
    providerModelId: model.providerModelId,
    modelCatalogueVersion: catalogue.version,
    privacyProfileId: provider.privacyProfileId,
    promptVersion: reviewPromptVersion,
    escalationThresholdBp,
    citationAcceptThresholdBp: defaultCitationAcceptThresholdBp,
    escalationBudgetCells,
    stateTokenBudget: 32_000,
    locale: table.locale,
  });

  // Zwei Schlüssel, beide an die Lauf-ID gebunden. Im Modus `model` gibt es kein
  // Jev: das Routing trägt dann die BYOK-Route des Modells, und es wird nie eine
  // Verbindung zu TypeSafe aufgebaut.
  const credentials: Credential[] = [];
  let routing: Credential;
  let escalation: Credential;
  try {
    routing = await connect(
      engine === "jev"
        ? {
            provider: "typesafe",
            purpose: "review_routing",
            bindingId: reviewRunId,
            requiredModelId: systemOneModelId,
            secret: input.routingApiKey,
          }
        : {
            provider: model.routeProvider,
            purpose: "review_routing",
            bindingId: reviewRunId,
            requiredModelId: model.providerModelId,
            secret: input.escalationApiKey,
          },
      engine === "jev" ? "REVIEW_TYPESAFE_KEY_REQUIRED" : "REVIEW_MODEL_KEY_REQUIRED",
    );
    credentials.push(routing);
    escalation = await connect(
      {
        provider: model.routeProvider,
        purpose: "review_escalation",
        bindingId: reviewRunId,
        requiredModelId: model.providerModelId,
        secret: input.escalationApiKey,
      },
      "REVIEW_MODEL_KEY_REQUIRED",
    );
    credentials.push(escalation);
  } catch (error) {
    await Promise.all(
      credentials.map((credential) =>
        deleteTemporaryCredential({
          credentialId: credential.credentialId,
          ownerUserId: actor.userId,
        }),
      ),
    );
    throw error;
  }
  const credentialDeadlineAt = new Date(
    Math.min(...credentials.map((credential) => Date.parse(credential.expiresAt))) -
      credentialSafetyMarginMilliseconds,
  );

  let result: StartReviewResult;
  try {
    result = await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`review:${table.id}`}, 0))`,
      );
      const concurrent = await findOpenRun(transaction, table.id);
      if (concurrent) return { ...concurrent, reused: true };

      const [run] = await transaction
        .insert(reviewRuns)
        .values({
          id: reviewRunId,
          reviewTableId: table.id,
          organizationId: table.organizationId,
          ownerUserId: actor.userId,
          totalCellCount: cellCount,
          decisionEngine: engine,
          documentSetHash,
          columnSetHash,
          configurationHash,
          routingProvider: engine === "jev" ? "typesafe" : model.routeProvider,
          jevModelId: engine === "jev" ? systemOneModelId : null,
          escalationProvider: model.routeProvider,
          providerModelId: model.providerModelId,
          modelProfileId: model.id,
          modelCatalogueVersion: catalogue.version,
          privacyProfileId: provider.privacyProfileId,
          promptVersion: reviewPromptVersion,
          escalationThresholdBp,
          citationAcceptThresholdBp: defaultCitationAcceptThresholdBp,
          escalationBudgetCells,
          stateTokenBudget: 32_000,
          routingCredentialId: routing.credentialId,
          escalationCredentialId: escalation.credentialId,
          credentialDeadlineAt,
        })
        .returning({ id: reviewRuns.id, status: reviewRuns.status });
      if (!run) throw new ReviewStartError("REVIEW_RUN_NOT_CREATED");

      const runDocuments = await transaction
        .insert(reviewRunDocuments)
        .values(
          documents.map((document) => ({
            reviewRunId: run.id,
            reviewDocumentId: document.id,
            policyVersionId: document.policyVersionId,
            ordinal: document.ordinal,
            displayName: document.displayName,
            policySha256: document.sha256,
            policyParserVersion: document.parserVersion,
          })),
        )
        .returning({ id: reviewRunDocuments.id });
      const runColumns = await transaction
        .insert(reviewRunColumns)
        .values(
          columns.map((column) => ({
            reviewRunId: run.id,
            reviewColumnId: column.id,
            ordinal: column.ordinal,
            label: column.label,
            columnType: column.columnType,
            instructions: column.instructions,
            criteria: column.criteria,
            contentHash: column.contentHash,
          })),
        )
        .returning({ id: reviewRunColumns.id });

      // Alle Zellen liegen vor dem ersten Schritt fest: die Unique-Bedingung
      // `(run_document_id, run_column_id)` ist der Idempotenzschlüssel des ganzen Laufs.
      const cells = runDocuments.flatMap((document) =>
        runColumns.map((column) => ({
          reviewRunId: run.id,
          runDocumentId: document.id,
          runColumnId: column.id,
        })),
      );
      for (let offset = 0; offset < cells.length; offset += 500) {
        await transaction
          .insert(reviewCells)
          .values(cells.slice(offset, offset + 500))
          .onConflictDoNothing({ target: [reviewCells.runDocumentId, reviewCells.runColumnId] });
      }

      await appendAuditEvent(transaction, {
        organizationId: table.organizationId,
        actorUserId: actor.userId,
        action: "review.queued",
        targetType: "review_run",
        targetId: run.id,
        metadata: {
          engine,
          contractCount: documents.length,
          columnCount: columns.length,
          modelProfileId: model.id,
        },
      });
      return { reviewRunId: run.id, status: run.status, reused: false };
    });
  } catch (error) {
    await Promise.all(
      credentials.map((credential) =>
        deleteTemporaryCredential({
          credentialId: credential.credentialId,
          ownerUserId: actor.userId,
        }),
      ),
    );
    throw error;
  }

  if (result.reused) {
    await Promise.all(
      credentials.map((credential) =>
        deleteTemporaryCredential({
          credentialId: credential.credentialId,
          ownerUserId: actor.userId,
        }),
      ),
    );
  }
  return launchPending(result, result.reused);
}

async function findOpenRun(executor: Pick<typeof db, "select">, reviewTableId: string) {
  const [run] = await executor
    .select({ reviewRunId: reviewRuns.id, status: reviewRuns.status })
    .from(reviewRuns)
    .where(
      and(
        eq(reviewRuns.reviewTableId, reviewTableId),
        inArray(reviewRuns.status, ["queued", "running"]),
      ),
    )
    .orderBy(asc(reviewRuns.createdAt))
    .limit(1);
  return run;
}

/**
 * Startet den Eltern-Lauf eines noch wartenden Laufs. Ist die Antwort auf einen
 * früheren Start verloren gegangen, ohne dass der Workflow lief, holt dies es nach —
 * der Eltern-Lauf beansprucht sich selbst über `workflow_run_id`, ein zweiter endet still.
 */
async function launchPending(result: Omit<StartReviewResult, "reused">, reused: boolean) {
  if (result.status === "queued") await launchReviewWorkflow(result.reviewRunId);
  return { ...result, reused };
}
