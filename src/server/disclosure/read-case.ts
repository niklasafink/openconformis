import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/server/db/client";
import { disclosureCaseDocuments, disclosureCases } from "@/server/db/schema/disclosure";
import { documentBlocks, policyVersions } from "@/server/db/schema/documents";

import { disclosurePermissionsOf, resolveDisclosureActor } from "./actor";
import { ownedCase } from "./manage-case";

export async function listDisclosureCases() {
  const actor = await resolveDisclosureActor();
  return db
    .select({
      id: disclosureCases.id,
      title: disclosureCases.title,
      updatedAt: disclosureCases.updatedAt,
    })
    .from(disclosureCases)
    .where(
      and(
        eq(disclosureCases.organizationId, actor.organizationId),
        eq(disclosureCases.status, "active"),
      ),
    )
    .orderBy(desc(disclosureCases.updatedAt))
    .limit(100);
}

export type DisclosureCaseDocument = {
  id: string;
  role: "report" | "prior_report" | "evidence";
  displayName: string;
  ordinal: number;
  policyVersionId: string | null;
  parseStatus: string | null;
};

export type DisclosureBlock = {
  id: string;
  blockKey: string;
  blockType: string;
  canonicalText: string;
  headingPath: string[];
  ordinal: number;
};

/** Eine Prüfung mit ihren Dokumenten in Reiter-Reihenfolge, oder `undefined`. */
export async function getDisclosureCase(caseId: string) {
  const actor = await resolveDisclosureActor();
  if (!z.uuid().safeParse(caseId).success) return undefined;
  // Prüfung und Dokumente zugleich: die Dokumentabfrage trägt die Zugehörigkeit zum
  // Arbeitsbereich selbst, damit sie nicht auf die erste Abfrage warten muss.
  const [found, documents] = await Promise.all([
    ownedCase(caseId, actor.organizationId),
    db
      .select({
        id: disclosureCaseDocuments.id,
        role: disclosureCaseDocuments.role,
        displayName: disclosureCaseDocuments.displayName,
        ordinal: disclosureCaseDocuments.ordinal,
        policyVersionId: disclosureCaseDocuments.policyVersionId,
        parseStatus: policyVersions.parseStatus,
      })
      .from(disclosureCaseDocuments)
      .innerJoin(disclosureCases, eq(disclosureCases.id, disclosureCaseDocuments.caseId))
      .leftJoin(policyVersions, eq(policyVersions.id, disclosureCaseDocuments.policyVersionId))
      .where(
        and(
          eq(disclosureCaseDocuments.caseId, caseId),
          eq(disclosureCases.organizationId, actor.organizationId),
          eq(disclosureCases.status, "active"),
        ),
      )
      .orderBy(asc(disclosureCaseDocuments.ordinal)),
  ]);
  if (!found) return undefined;
  return {
    id: found.id,
    title: found.title,
    documents: documents as DisclosureCaseDocument[],
    permissions: disclosurePermissionsOf(actor),
  };
}

/** Die unveränderlichen Blöcke der angegebenen Fassungen, nach Fassung gruppiert. */
export async function readDocumentBlocks(policyVersionIds: readonly string[]) {
  if (policyVersionIds.length === 0) return new Map<string, DisclosureBlock[]>();
  const rows = await db
    .select({
      policyVersionId: documentBlocks.policyVersionId,
      id: documentBlocks.id,
      blockKey: documentBlocks.blockKey,
      blockType: documentBlocks.blockType,
      canonicalText: documentBlocks.canonicalText,
      headingPath: documentBlocks.headingPath,
      ordinal: documentBlocks.ordinal,
    })
    .from(documentBlocks)
    .where(inArray(documentBlocks.policyVersionId, [...policyVersionIds]))
    .orderBy(asc(documentBlocks.ordinal));
  const byVersion = new Map<string, DisclosureBlock[]>();
  for (const { policyVersionId, ...block } of rows) {
    const list = byVersion.get(policyVersionId) ?? [];
    list.push({ ...block, headingPath: block.headingPath ?? [] });
    byVersion.set(policyVersionId, list);
  }
  return byVersion;
}
