import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import { anonymousDrafts } from "@/server/db/schema/application";
import { policies, policyVersions } from "@/server/db/schema/documents";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Die Felder einer Fassung, die über ihre Übernahme in einen Arbeitsbereich entscheiden. */
export type AdoptableVersion = {
  id: string;
  policyId: string;
  organizationId: string | null;
  anonymousDraftId: string | null;
  sha256: string | null;
  parserVersion: string | null;
  parseStatus: string;
  originalFilename: string;
  detectedMimeType: string | null;
};

export async function readAdoptableVersion(policyVersionId: string) {
  const [version] = await db
    .select({
      id: policyVersions.id,
      policyId: policyVersions.policyId,
      organizationId: policyVersions.organizationId,
      anonymousDraftId: policyVersions.anonymousDraftId,
      sha256: policyVersions.sha256,
      parserVersion: policyVersions.parserVersion,
      parseStatus: policyVersions.parseStatus,
      originalFilename: policyVersions.originalFilename,
      detectedMimeType: policyVersions.detectedMimeType,
    })
    .from(policyVersions)
    .where(eq(policyVersions.id, policyVersionId))
    .limit(1);
  return version as AdoptableVersion | undefined;
}

/**
 * Darf der Akteur diese Fassung verwenden? Entweder gehört sie schon seinem
 * Arbeitsbereich, oder sie stammt aus seinem noch aktiven, gebundenen Entwurf und
 * wird beim Hinzufügen übernommen. Alles andere ist „nicht gefunden“.
 */
export async function versionAccess(
  version: AdoptableVersion,
  organizationId: string,
  draftId: string | undefined,
): Promise<"owned" | "adopt" | "denied"> {
  if (version.organizationId === organizationId) return "owned";
  if (version.organizationId === null && version.anonymousDraftId && draftId) {
    const draft = await getBoundActiveDraft(draftId);
    if (draft && draft.id === version.anonymousDraftId) return "adopt";
  }
  return "denied";
}

/**
 * Übernimmt eine fertig aufbereitete Fassung aus dem Entwurf in den Arbeitsbereich —
 * derselbe Schritt wie beim Analysestart. Liegt dort schon eine identische Fassung
 * (`organisation, sha256, parser` ist eindeutig), wird sie wiederverwendet. Die
 * Datenbank lässt die Übernahme nur zu, wenn der Entwurf zuvor beansprucht wurde.
 *
 * Gibt die ID der wirksamen Fassung zurück, oder `undefined`, wenn der Entwurf nicht
 * mehr aktiv ist.
 */
export async function adoptDraftVersion(
  transaction: Transaction,
  version: AdoptableVersion,
  actor: { userId: string; organizationId: string },
): Promise<string | undefined> {
  const [identical] = await transaction
    .select({ id: policyVersions.id })
    .from(policyVersions)
    .where(
      and(
        eq(policyVersions.organizationId, actor.organizationId),
        eq(policyVersions.sha256, version.sha256!),
        eq(policyVersions.parserVersion, version.parserVersion!),
      ),
    )
    .limit(1);
  if (identical) return identical.id;

  const [claimed] = await transaction
    .update(anonymousDrafts)
    .set({
      status: "claimed",
      claimedByUserId: actor.userId,
      claimedAt: new Date(),
      updatedAt: new Date(),
      revision: sql`${anonymousDrafts.revision} + 1`,
    })
    .where(
      and(eq(anonymousDrafts.id, version.anonymousDraftId!), eq(anonymousDrafts.status, "active")),
    )
    .returning({ id: anonymousDrafts.id });
  if (!claimed) return undefined;
  await transaction
    .update(policies)
    .set({
      organizationId: actor.organizationId,
      anonymousDraftId: null,
      ownerUserId: actor.userId,
      updatedAt: new Date(),
    })
    .where(eq(policies.id, version.policyId));
  await transaction
    .update(policyVersions)
    .set({ organizationId: actor.organizationId, anonymousDraftId: null })
    .where(eq(policyVersions.id, version.id));
  return version.id;
}
