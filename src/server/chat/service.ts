import "server-only";

import { and, asc, desc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { validateChatCitations, unsupportedChatAnswer } from "@/domain/chat/citations";
import {
  createFrameworkChatSource,
  createPolicyChatSource,
  selectChatSources,
  type ChatRetrievalSource,
  type RankedChatSource,
} from "@/domain/chat/retrieval";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { appendAuditEvent } from "@/server/audit/event";
import { requireSessionPrincipal } from "@/server/auth/session-principal";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { db } from "@/server/db/client";
import { analyses } from "@/server/db/schema/analyses";
import {
  regulatoryFrameworkLocalizations,
  regulatoryFrameworkReleases,
  regulatoryFrameworks,
  regulatoryRequirements,
  regulatorySubrequirements,
} from "@/server/db/schema/catalogue";
import { chatCitations, chatMessages, chatThreads } from "@/server/db/schema/chat";
import { documentBlocks } from "@/server/db/schema/documents";

import { buildChatSystemPrompt } from "@/server/ai/chat-prompt";
import { findChatDocument, type ChatDocument } from "./documents";

import { getChatProviderConfiguration } from "@/server/ai/chat-provider-configuration";
import {
  streamChatModel,
  type ChatHistoryMessage,
  type ChatStreamResult,
} from "@/server/ai/chat-stream";
import { resolveChatModelSelection } from "@/server/ai/model-catalogue";
import { withTemporaryCredential } from "@/server/ai/temporary-credential-service";

const createTurnSchema = z
  .object({
    threadId: z.uuid().optional(),
    analysisId: z.uuid().optional(),
    policyVersionId: z.uuid().optional(),
    frameworkSlug: z.string().trim().min(1).max(100).optional(),
    message: z.string().trim().min(1).max(8_000),
    credentialId: z.uuid(),
    modelProfileId: z.string().trim().min(1).max(300),
    modelCatalogueVersion: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    unevaluatedWarningAccepted: z.boolean().default(false),
    locale: z.enum(["de", "en"]),
  })
  .strict();

export class ChatServiceError extends Error {
  constructor(
    public readonly code:
      | "CHAT_THREAD_NOT_FOUND"
      | "CHAT_FRAMEWORK_NOT_FOUND"
      | "CHAT_DOCUMENT_NOT_FOUND"
      | "CHAT_MODEL_NOT_CERTIFIED"
      | "CHAT_RATE_LIMITED",
  ) {
    super(code);
    this.name = "ChatServiceError";
  }
}

async function resolveThread(
  input: z.infer<typeof createTurnSchema>,
  principal: Awaited<ReturnType<typeof requireSessionPrincipal>>,
) {
  if (input.threadId) {
    const [thread] = await db
      .select()
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.id, input.threadId),
          eq(chatThreads.ownerUserId, principal.userId),
          eq(chatThreads.organizationId, principal.organizationId),
          isNull(chatThreads.deletedAt),
          gt(chatThreads.deleteAfter, new Date()),
        ),
      )
      .limit(1);
    if (!thread) throw new ChatServiceError("CHAT_THREAD_NOT_FOUND");
    return thread;
  }

  let frameworkSlug = input.frameworkSlug;
  let policyVersionId = input.policyVersionId ?? null;
  let analysisId: string | null = null;

  // Eine Analyse bringt beide Seiten mit: Wer aus einem Ergebnis heraus fragt,
  // soll nicht Rahmenwerk und Dokument noch einmal von Hand wählen müssen.
  if (input.analysisId) {
    const [analysis] = await db
      .select({
        id: analyses.id,
        frameworkSlug: analyses.frameworkSlug,
        policyVersionId: analyses.policyVersionId,
      })
      .from(analyses)
      .where(
        and(
          eq(analyses.id, input.analysisId),
          eq(analyses.ownerUserId, principal.userId),
          eq(analyses.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    if (analysis) {
      analysisId = analysis.id;
      frameworkSlug ??= analysis.frameworkSlug;
      policyVersionId ??= analysis.policyVersionId;
    }
  }

  let frameworkReleaseId: string | null = null;
  if (frameworkSlug) {
    const [release] = await db
      .select({ id: regulatoryFrameworkReleases.id })
      .from(regulatoryFrameworkReleases)
      .innerJoin(
        regulatoryFrameworks,
        eq(regulatoryFrameworkReleases.frameworkId, regulatoryFrameworks.id),
      )
      .where(
        and(
          eq(regulatoryFrameworks.slug, frameworkSlug),
          eq(regulatoryFrameworkReleases.status, "published"),
        ),
      )
      .orderBy(desc(regulatoryFrameworkReleases.publishedAt))
      .limit(1);
    if (!release) throw new ChatServiceError("CHAT_FRAMEWORK_NOT_FOUND");
    frameworkReleaseId = release.id;
  }

  // Das Dokument wird gegen dieselbe Liste geprüft, die der Chat zur Auswahl
  // anbietet. Eine fremde Fassung erzeugt keinen Thread ohne Dokument, sondern
  // einen Fehler — sonst antwortet der Chat stillschweigend ohne Policy.
  if (policyVersionId && !(await findChatDocument(policyVersionId))) {
    throw new ChatServiceError("CHAT_DOCUMENT_NOT_FOUND");
  }

  const [thread] = await db
    .insert(chatThreads)
    .values({
      organizationId: principal.organizationId,
      ownerUserId: principal.userId,
      analysisId,
      policyVersionId,
      frameworkReleaseId,
      title: input.message.slice(0, 160),
      locale: input.locale,
      deleteAfter: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    })
    .returning();
  if (!thread) throw new ChatServiceError("CHAT_THREAD_NOT_FOUND");
  return thread;
}

async function readFrameworkRelease(frameworkReleaseId: string | null, locale: "de" | "en") {
  if (!frameworkReleaseId) return null;
  const [release] = await db
    .select({
      version: regulatoryFrameworkReleases.version,
      authoritativeLanguage: regulatoryFrameworkReleases.authoritativeLanguage,
      contentClassification: regulatoryFrameworkReleases.contentClassification,
      slug: regulatoryFrameworks.slug,
    })
    .from(regulatoryFrameworkReleases)
    .innerJoin(
      regulatoryFrameworks,
      eq(regulatoryFrameworkReleases.frameworkId, regulatoryFrameworks.id),
    )
    .where(eq(regulatoryFrameworkReleases.id, frameworkReleaseId))
    .limit(1);
  if (!release) return null;
  const localizations = await db
    .select({
      locale: regulatoryFrameworkLocalizations.locale,
      name: regulatoryFrameworkLocalizations.name,
    })
    .from(regulatoryFrameworkLocalizations)
    .innerJoin(
      regulatoryFrameworks,
      eq(regulatoryFrameworkLocalizations.frameworkId, regulatoryFrameworks.id),
    )
    .where(eq(regulatoryFrameworks.slug, release.slug));
  const name =
    localizations.find((entry) => entry.locale === locale)?.name ??
    localizations.find((entry) => entry.locale === "de")?.name ??
    release.slug;
  return { ...release, name };
}

async function retrieveFrameworkSources(frameworkReleaseId: string | null) {
  if (!frameworkReleaseId) return [];
  const [requirements, subrequirements] = await Promise.all([
    db
      .select({
        id: regulatoryRequirements.id,
        regulatoryId: regulatoryRequirements.regulatoryId,
        title: regulatoryRequirements.title,
        legalText: regulatoryRequirements.legalText,
        sourceLocator: regulatoryRequirements.sourceLocator,
      })
      .from(regulatoryRequirements)
      .where(eq(regulatoryRequirements.releaseId, frameworkReleaseId))
      .orderBy(asc(regulatoryRequirements.displayOrder))
      .limit(500),
    db
      .select({
        id: regulatorySubrequirements.id,
        regulatoryId: regulatorySubrequirements.regulatoryId,
        title: regulatorySubrequirements.title,
        legalText: regulatorySubrequirements.legalText,
        sourceLocator: regulatorySubrequirements.sourceLocator,
      })
      .from(regulatorySubrequirements)
      .where(eq(regulatorySubrequirements.releaseId, frameworkReleaseId))
      .orderBy(asc(regulatorySubrequirements.displayOrder))
      .limit(500),
  ]);
  return [
    ...requirements.map((requirement) =>
      createFrameworkChatSource({
        sourceId: requirement.id,
        regulatoryId: requirement.regulatoryId,
        title: requirement.title,
        legalText: requirement.legalText,
        sourceLocator: requirement.sourceLocator,
      }),
    ),
    ...subrequirements.map((requirement) =>
      createFrameworkChatSource({
        sourceType: "framework_subrequirement",
        sourceId: requirement.id,
        regulatoryId: requirement.regulatoryId,
        title: requirement.title,
        legalText: requirement.legalText,
        sourceLocator: requirement.sourceLocator,
      }),
    ),
  ];
}

/**
 * Die geparsten Blöcke der gewählten Policy-Fassung. Sie sind dieselbe
 * unveränderliche Grundlage, aus der die Analyse ihre Belege zieht — nur so
 * passen Blockschlüssel aus dem Chat und aus dem Ergebnis zusammen.
 */
async function retrievePolicySources(
  document: ChatDocument | null,
  locale: "de" | "en",
): Promise<ChatRetrievalSource[]> {
  if (!document) return [];
  const blocks = await db
    .select({
      id: documentBlocks.id,
      blockKey: documentBlocks.blockKey,
      ordinal: documentBlocks.ordinal,
      canonicalText: documentBlocks.canonicalText,
      headingPath: documentBlocks.headingPath,
      pageNumber: documentBlocks.pageNumber,
      paragraphNumber: documentBlocks.paragraphNumber,
    })
    .from(documentBlocks)
    .where(eq(documentBlocks.policyVersionId, document.policyVersionId))
    .orderBy(asc(documentBlocks.ordinal))
    .limit(4_000);
  return blocks.map((block) =>
    createPolicyChatSource({
      documentBlockId: block.id,
      blockKey: block.blockKey,
      ordinal: block.ordinal,
      canonicalText: block.canonicalText,
      headingPath: block.headingPath,
      pageNumber: block.pageNumber,
      paragraphNumber: block.paragraphNumber,
      documentName: document.displayName,
      locale,
    }),
  );
}

async function enforceRateLimit(userId: string, organizationId: string) {
  const [result] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatMessages.threadId, chatThreads.id))
    .where(
      and(
        eq(chatThreads.ownerUserId, userId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
  if ((result?.count ?? 0) >= 10) throw new ChatServiceError("CHAT_RATE_LIMITED");
  const [organizationResult] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatMessages.threadId, chatThreads.id))
    .where(
      and(
        eq(chatThreads.organizationId, organizationId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
  if ((organizationResult?.count ?? 0) >= 100) {
    throw new ChatServiceError("CHAT_RATE_LIMITED");
  }
}

export type ChatTurnCallbacks = {
  onSources(sources: RankedChatSource[]): void;
  onDelta(delta: string): void;
  onFinal(result: {
    threadId: string;
    messageId: string;
    content: string;
    citations: ReturnType<typeof validateChatCitations>["citations"];
  }): void;
};

export async function executeChatTurn(
  rawInput: unknown,
  callbacks: ChatTurnCallbacks,
  signal?: AbortSignal,
) {
  const input = createTurnSchema.parse(rawInput);
  const [principal, user, selection] = await Promise.all([
    requireSessionPrincipal(),
    requireAuthenticatedSessionUser(),
    resolveChatModelSelection({
      modelProfileId: input.modelProfileId,
      catalogueVersion: input.modelCatalogueVersion,
    }),
  ]);
  if (principal.userId !== user.id) {
    throw new ChatServiceError("CHAT_THREAD_NOT_FOUND");
  }
  if (!selection.model.evaluated && !input.unevaluatedWarningAccepted) {
    throw new ChatServiceError("CHAT_MODEL_NOT_CERTIFIED");
  }
  await enforceRateLimit(principal.userId, principal.organizationId);
  const thread = await resolveThread(input, principal);
  const [framework, document, history] = await Promise.all([
    readFrameworkRelease(thread.frameworkReleaseId, input.locale),
    thread.policyVersionId ? findChatDocument(thread.policyVersionId) : null,
    db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(and(eq(chatMessages.threadId, thread.id), eq(chatMessages.status, "completed")))
      .orderBy(desc(chatMessages.createdAt))
      .limit(12),
  ]);
  const [frameworkSources, policySources] = await Promise.all([
    retrieveFrameworkSources(thread.frameworkReleaseId),
    retrievePolicySources(document, input.locale),
  ]);
  const sources = selectChatSources({
    question: input.message,
    frameworkSources,
    policySources,
  });
  callbacks.onSources(sources);
  const messages: ChatHistoryMessage[] = [
    ...history.reverse().map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: input.message },
  ];
  const configuration = getChatProviderConfiguration(selection.model.routeProvider);
  const startedAt = Date.now();
  let rawContent = "";
  let metadata: ChatStreamResult = {};

  await withTemporaryCredential(
    {
      credentialId: input.credentialId,
      ownerUserId: principal.userId,
      provider: selection.model.routeProvider,
      purpose: "chat",
      bindingId: user.sessionId,
      requiredModelId: selection.model.providerModelId,
    },
    async (apiKey) => {
      const iterator = streamChatModel({
        configuration,
        apiKey,
        modelId: selection.model.providerModelId,
        system: buildChatSystemPrompt({
          locale: input.locale,
          framework,
          document: document
            ? {
                name: document.displayName,
                source: document.source,
                pageCount: document.pageCount,
                authoritativeLanguage: document.authoritativeLanguage,
              }
            : null,
          sources,
        }),
        messages,
        signal,
      });
      while (true) {
        const next = await iterator.next();
        if (next.done) {
          metadata = next.value;
          break;
        }
        rawContent += next.value;
        callbacks.onDelta(next.value);
      }
    },
  );

  const validated = validateChatCitations(rawContent.trim(), sources);
  const content = validated.valid ? validated.content : unsupportedChatAnswer(input.locale);
  const citations = validated.valid ? validated.citations : [];
  const inputHash = createContentHash({
    organizationId: principal.organizationId,
    threadId: thread.id,
    sourceHashes: sources.map((source) => source.sourceHash),
    message: input.message,
    modelId: selection.model.providerModelId,
  });
  const result = await db.transaction(async (transaction) => {
    await transaction.insert(chatMessages).values({
      threadId: thread.id,
      role: "user",
      content: input.message,
    });
    const [assistant] = await transaction
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        role: "assistant",
        content,
        routeProvider: selection.model.routeProvider,
        modelProfileId: selection.model.id,
        providerModelId: selection.model.providerModelId,
        modelCatalogueVersion: selection.catalogue.version,
        evaluationVersion: selection.model.evaluationVersion,
        providerRequestId: metadata.providerRequestId,
        inputHash,
        inputTokens: metadata.inputTokens,
        outputTokens: metadata.outputTokens,
        cachedInputTokens: metadata.cachedInputTokens,
        latencyMilliseconds: Date.now() - startedAt,
      })
      .returning({ id: chatMessages.id });
    if (!assistant) throw new ChatServiceError("CHAT_THREAD_NOT_FOUND");
    if (citations.length > 0) {
      await transaction.insert(chatCitations).values(
        citations.map((citation) => ({
          messageId: assistant.id,
          citationOrder: citation.citationOrder,
          sourceType: citation.sourceType,
          requirementId: citation.requirementId,
          subrequirementId: citation.subrequirementId,
          documentBlockId: citation.documentBlockId,
          sourceLabel: citation.label,
          sourceLocator: citation.locator,
          exactQuote: citation.exactQuote,
          sourceHash: citation.sourceHash,
        })),
      );
    }
    await transaction
      .update(chatThreads)
      .set({ updatedAt: new Date() })
      .where(eq(chatThreads.id, thread.id));
    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "chat.turn_completed",
      targetType: "chat_thread",
      targetId: thread.id,
      metadata: {
        routeProvider: selection.model.routeProvider,
        modelProfileId: selection.model.id,
        citationCount: citations.length,
        // Keine Inhalte, nur die Form des Kontexts: sonst landet Policy-Text im Audit.
        frameworkSourceCount: sources.filter((source) => source.sourceType !== "policy_block")
          .length,
        policySourceCount: sources.filter((source) => source.sourceType === "policy_block").length,
      },
    });
    return { messageId: assistant.id };
  });
  callbacks.onFinal({ threadId: thread.id, messageId: result.messageId, content, citations });
}

export async function listRecentChatThreads() {
  const [principal, user] = await Promise.all([
    requireSessionPrincipal(),
    requireAuthenticatedSessionUser(),
  ]);
  if (principal.userId !== user.id) return [];
  return db
    .select({ id: chatThreads.id, title: chatThreads.title, updatedAt: chatThreads.updatedAt })
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.organizationId, principal.organizationId),
        eq(chatThreads.ownerUserId, principal.userId),
        isNull(chatThreads.deletedAt),
        gt(chatThreads.deleteAfter, new Date()),
      ),
    )
    .orderBy(desc(chatThreads.updatedAt))
    .limit(20);
}

export async function getChatThreadMessages(threadId: string) {
  const principal = await requireSessionPrincipal();
  const [thread] = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.id, threadId),
        eq(chatThreads.organizationId, principal.organizationId),
        eq(chatThreads.ownerUserId, principal.userId),
        isNull(chatThreads.deletedAt),
      ),
    )
    .limit(1);
  if (!thread) throw new ChatServiceError("CHAT_THREAD_NOT_FOUND");
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, thread.id))
    .orderBy(asc(chatMessages.createdAt));
  const citations = await db
    .select()
    .from(chatCitations)
    .where(
      sql`${chatCitations.messageId} in (select ${chatMessages.id} from ${chatMessages} where ${chatMessages.threadId} = ${thread.id})`,
    )
    .orderBy(asc(chatCitations.citationOrder));
  return { messages, citations };
}
