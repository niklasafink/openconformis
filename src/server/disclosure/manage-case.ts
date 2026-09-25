import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { docxMimeType } from "@/domain/policies/upload";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { disclosureCaseDocuments, disclosureCases } from "@/server/db/schema/disclosure";
import {
  adoptDraftVersion,
  readAdoptableVersion,
  versionAccess,
} from "@/server/policies/adopt-draft-version";

import { requirePreparer, resolveDisclosureActor } from "./actor";

/**
 * Anlegen und Befüllen einer Prüfung. Wie in der Vertragsprüfung liefern die
 * Funktionen ein ausdrückliches Ergebnis statt Ausnahmen:
 *
 *   `{ ok: true, … } | { ok: false, code }`
 */
export type DisclosureFailure = { ok: false; code: string };

const titleSchema = z.string().trim().min(1).max(200);

export async function ownedCase(caseId: string, organizationId: string) {
  if (!z.uuid().safeParse(caseId).success) return undefined;
  const [found] = await db
    .select()
    .from(disclosureCases)
    .where(
      and(
        eq(disclosureCases.id, caseId),
        eq(disclosureCases.organizationId, organizationId),
        eq(disclosureCases.status, "active"),
      ),
    )
    .limit(1);
  return found;
}

function failureOf(error: unknown): DisclosureFailure {
  if (error instanceof z.ZodError) return { ok: false, code: "DISCLOSURE_INPUT_INVALID" };
  const code = (error as { code?: string } | null)?.code;
  if (
    code === "DISCLOSURE_FORBIDDEN" ||
    code === "REVIEW_FORBIDDEN" ||
    code === "MEMBERSHIP_REQUIRED"
  ) {
    return { ok: false, code: "DISCLOSURE_FORBIDDEN" };
  }
  throw error;
}

export async function createDisclosureCase(input: {
  title: string;
}): Promise<{ ok: true; caseId: string } | DisclosureFailure> {
  try {
    const actor = requirePreparer(await resolveDisclosureActor());
    const title = titleSchema.parse(input.title);
    const [created] = await db
      .insert(disclosureCases)
      .values({ organizationId: actor.organizationId, ownerUserId: actor.userId, title })
      .returning({ id: disclosureCases.id });
    return { ok: true, caseId: created!.id };
  } catch (error) {
    return failureOf(error);
  }
}

export async function renameDisclosureCase(input: {
  caseId: string;
  title: string;
}): Promise<{ ok: true } | DisclosureFailure> {
  try {
    const actor = requirePreparer(await resolveDisclosureActor());
    const title = titleSchema.parse(input.title);
    const found = await ownedCase(input.caseId, actor.organizationId);
    if (!found) return { ok: false, code: "DISCLOSURE_CASE_NOT_FOUND" };
    await db
      .update(disclosureCases)
      .set({ title, updatedAt: new Date() })
      .where(eq(disclosureCases.id, found.id));
    return { ok: true };
  } catch (error) {
    return failureOf(error);
  }
}

/**
 * Hängt den Prüfungsbericht an. Er muss Word sein: der Bereich kennt genau einen
 * Parserpfad (DOCX), PDF wird vorher lokal umgewandelt. Die Prüfung steht hier ein
 * zweites Mal nach der Intent-Route, weil eine Fassung auch aus einem anderen Weg
 * der Kette stammen könnte — maßgeblich ist der erkannte, nicht der erklärte Typ.
 */
export async function attachDisclosureReport(input: {
  caseId: string;
  policyVersionId: string;
  draftId?: string;
}): Promise<{ ok: true; caseDocumentId: string } | DisclosureFailure> {
  try {
    const actor = requirePreparer(await resolveDisclosureActor());
    const found = await ownedCase(input.caseId, actor.organizationId);
    if (!found) return { ok: false, code: "DISCLOSURE_CASE_NOT_FOUND" };
    const version = await readAdoptableVersion(z.uuid().parse(input.policyVersionId));
    if (!version) return { ok: false, code: "DISCLOSURE_DOCUMENT_NOT_FOUND" };
    const access = await versionAccess(version, actor.organizationId, input.draftId);
    if (access === "denied") return { ok: false, code: "DISCLOSURE_DOCUMENT_NOT_FOUND" };
    if (version.parseStatus !== "ready" || !version.sha256 || !version.parserVersion) {
      return { ok: false, code: "DISCLOSURE_DOCUMENT_NOT_READY" };
    }
    if (version.detectedMimeType !== docxMimeType) {
      return { ok: false, code: "DISCLOSURE_REPORT_DOCX_ONLY" };
    }

    return await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-documents:${found.id}`}, 0))`,
      );
      let effectiveVersionId = version.id;
      if (access === "adopt") {
        const adopted = await adoptDraftVersion(transaction, version, actor);
        if (!adopted) return { ok: false as const, code: "DISCLOSURE_DOCUMENT_NOT_FOUND" };
        effectiveVersionId = adopted;
      }
      const [existingReport] = await transaction
        .select({
          id: disclosureCaseDocuments.id,
          policyVersionId: disclosureCaseDocuments.policyVersionId,
        })
        .from(disclosureCaseDocuments)
        .where(
          and(
            eq(disclosureCaseDocuments.caseId, found.id),
            eq(disclosureCaseDocuments.role, "report"),
          ),
        )
        .limit(1);
      if (existingReport) {
        if (existingReport.policyVersionId === effectiveVersionId) {
          return { ok: true as const, caseDocumentId: existingReport.id };
        }
        return { ok: false as const, code: "DISCLOSURE_REPORT_EXISTS" };
      }
      // Der Bericht steht immer als erster Reiter (Ordinal 0); Belege folgen ab 1.
      const [document] = await transaction
        .insert(disclosureCaseDocuments)
        .values({
          caseId: found.id,
          role: "report",
          policyVersionId: effectiveVersionId,
          ordinal: 0,
          displayName: version.originalFilename.slice(0, 255),
        })
        .returning({ id: disclosureCaseDocuments.id });
      await transaction
        .update(disclosureCases)
        .set({ updatedAt: new Date() })
        .where(eq(disclosureCases.id, found.id));
      await appendAuditEvent(transaction, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "disclosure_document.added",
        targetType: "disclosure_case_document",
        targetId: document!.id,
        metadata: { role: "report", adoptedFromDraft: access === "adopt" },
      });
      return { ok: true as const, caseDocumentId: document!.id };
    });
  } catch (error) {
    return failureOf(error);
  }
}
