import "server-only";

import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

import { requireSessionPrincipal } from "@/server/auth/session-principal";
import { db } from "@/server/db/client";
import { draftPolicySelections, policies, policyVersions } from "@/server/db/schema/documents";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";

export type ChatDocument = {
  policyVersionId: string;
  displayName: string;
  source: "sample" | "upload";
  pageCount: number | null;
  authoritativeLanguage: string | null;
  createdAt: Date;
};

const documentColumns = {
  policyVersionId: policyVersions.id,
  displayName: policies.displayName,
  source: policyVersions.source,
  pageCount: policyVersions.pageCount,
  authoritativeLanguage: policyVersions.authoritativeLanguage,
  createdAt: policyVersions.createdAt,
};

/**
 * Nur fertig geparste Fassungen kommen in Frage: ohne Blöcke gibt es nichts zu
 * belegen, und eine abgelaufene Aufbewahrung hat die Blöcke bereits gelöscht.
 */
function readable() {
  return [
    eq(policyVersions.parseStatus, "ready"),
    isNull(policyVersions.deletedAt),
    isNull(policyVersions.parsedDeletedAt),
  ];
}

/**
 * Dokumente des Arbeitsbereichs, die diesem Nutzer gehören. Eine Policy-Fassung
 * wird beim Start einer Analyse aus dem Draft in die Organisation übernommen;
 * vorher liegt sie nur am Draft, der über das Bindungs-Cookie nachgewiesen wird.
 */
async function listOwnedDocuments(input: {
  organizationId: string;
  userId: string;
  policyVersionId?: string;
  limit: number;
}) {
  const filters: SQL[] = [
    eq(policies.organizationId, input.organizationId),
    eq(policies.ownerUserId, input.userId),
    eq(policies.lifecycleStatus, "active"),
    ...readable(),
  ];
  if (input.policyVersionId) filters.push(eq(policyVersions.id, input.policyVersionId));
  return db
    .select(documentColumns)
    .from(policyVersions)
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(and(...filters))
    .orderBy(desc(policyVersions.createdAt))
    .limit(input.limit);
}

/** Die Policy des gerade gebundenen Drafts — hochgeladen, aber noch nicht analysiert. */
async function readDraftDocument() {
  const draft = await getBoundActiveDraft();
  if (!draft) return null;
  const [document] = await db
    .select(documentColumns)
    .from(draftPolicySelections)
    .innerJoin(policyVersions, eq(policyVersions.id, draftPolicySelections.policyVersionId))
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(and(eq(draftPolicySelections.anonymousDraftId, draft.id), ...readable()))
    .limit(1);
  return document ?? null;
}

/**
 * Die im Chat auswählbaren Dokumente. Dieselbe Liste ist die Autorisierung:
 * was hier nicht steht, wird auch nicht als Quelle geladen.
 */
export async function listChatDocuments(): Promise<ChatDocument[]> {
  const principal = await requireSessionPrincipal();
  const [owned, draftDocument] = await Promise.all([
    listOwnedDocuments({
      organizationId: principal.organizationId,
      userId: principal.userId,
      limit: 30,
    }),
    readDraftDocument().catch(() => null),
  ]);
  const documents = draftDocument ? [draftDocument, ...owned] : owned;
  const unique = new Map<string, ChatDocument>();
  for (const document of documents) {
    if (!unique.has(document.policyVersionId)) unique.set(document.policyVersionId, document);
  }
  return [...unique.values()];
}

/**
 * Prüft, ob der Nutzer dieses Dokument im Chat verwenden darf. Ein Treffer über
 * die eigene Analyse zählt ebenso wie der Besitz im Arbeitsbereich; der Draft
 * zählt nur, solange sein Bindungs-Cookie mitkommt.
 */
export async function findChatDocument(policyVersionId: string): Promise<ChatDocument | null> {
  const principal = await requireSessionPrincipal();
  const [owned] = await listOwnedDocuments({
    organizationId: principal.organizationId,
    userId: principal.userId,
    policyVersionId,
    limit: 1,
  });
  if (owned) return owned;
  const draftDocument = await readDraftDocument().catch(() => null);
  return draftDocument?.policyVersionId === policyVersionId ? draftDocument : null;
}
