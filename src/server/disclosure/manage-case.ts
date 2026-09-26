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

import { launchDisclosureRecognitionWorkflow } from "@/server/workflows/launch";

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
 * Hängt den Prüfungsbericht oder den Vorjahresbericht an. Beide müssen Word sein: der
 * Bereich kennt genau einen Parserpfad (DOCX), PDF wird vorher lokal umgewandelt. Die
 * Prüfung steht hier ein zweites Mal nach der Intent-Route, weil eine Fassung auch aus
 * einem anderen Weg der Kette stammen könnte — maßgeblich ist der erkannte, nicht der
 * erklärte Typ. Je Prüfung gibt es höchstens einen Bericht und einen Vorjahresbericht.
 */
export async function attachDisclosureReport(input: {
  caseId: string;
  policyVersionId: string;
  draftId?: string;
  role?: "report" | "prior_report";
}): Promise<{ ok: true; caseDocumentId: string } | DisclosureFailure> {
  const role = input.role ?? "report";
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

    const attached = await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-documents:${found.id}`}, 0))`,
      );
      let effectiveVersionId = version.id;
      if (access === "adopt") {
        const adopted = await adoptDraftVersion(transaction, version, actor);
        if (!adopted) return { ok: false as const, code: "DISCLOSURE_DOCUMENT_NOT_FOUND" };
        effectiveVersionId = adopted;
      }
      const documents = await transaction
        .select({
          id: disclosureCaseDocuments.id,
          role: disclosureCaseDocuments.role,
          policyVersionId: disclosureCaseDocuments.policyVersionId,
          ordinal: disclosureCaseDocuments.ordinal,
        })
        .from(disclosureCaseDocuments)
        .where(eq(disclosureCaseDocuments.caseId, found.id));
      const existing = documents.find((document) => document.role === role);
      if (existing) {
        if (existing.policyVersionId === effectiveVersionId) {
          return { ok: true as const, caseDocumentId: existing.id };
        }
        return {
          ok: false as const,
          code: role === "report" ? "DISCLOSURE_REPORT_EXISTS" : "DISCLOSURE_PRIOR_REPORT_EXISTS",
        };
      }
      if (role === "prior_report") {
        const report = documents.find((document) => document.role === "report");
        if (!report) return { ok: false as const, code: "DISCLOSURE_REPORT_MISSING" };
        if (report.policyVersionId === effectiveVersionId) {
          return { ok: false as const, code: "DISCLOSURE_PRIOR_REPORT_SAME" };
        }
      }
      // Der Bericht steht immer als erster Reiter (Ordinal 0); Vorjahresbericht und
      // Belege folgen in der Reihenfolge ihres Hinzufügens.
      const ordinal =
        role === "report"
          ? 0
          : Math.max(0, ...documents.map((document) => Number(document.ordinal))) + 1;
      const [document] = await transaction
        .insert(disclosureCaseDocuments)
        .values({
          caseId: found.id,
          role,
          policyVersionId: effectiveVersionId,
          ordinal,
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
        metadata: { role, adoptedFromDraft: access === "adopt" },
      });
      return { ok: true as const, caseDocumentId: document!.id };
    });
    if (attached.ok) await startRecognition(attached.caseDocumentId);
    return attached;
  } catch (error) {
    return failureOf(error);
  }
}

/**
 * Startet die Erkennung eines Berichts. Scheitert der Start, bleibt der Bericht auf
 * `pending`; die Seite startet ihn beim nächsten Aufruf erneut.
 */
export async function startRecognition(caseDocumentId: string) {
  try {
    await launchDisclosureRecognitionWorkflow(caseDocumentId);
  } catch {
    // Kein Fehler für den Nutzer: der Bericht ist angehängt, die Erkennung folgt.
  }
}
