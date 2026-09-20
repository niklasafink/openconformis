"use server";

import { hasLocale } from "next-intl";

import type { ReviewColumnInput } from "@/domain/review/column";
import { routing } from "@/i18n/routing";
import { listFrameworkCatalogue } from "@/server/catalogue/service";
import {
  getBoundActiveDraft,
  persistFrameworkSelection,
} from "@/server/drafts/framework-selection";
import { selectSamplePolicy } from "@/server/policies/sample-service";
import {
  addReviewColumn,
  addReviewDocument,
  archiveReviewColumn,
  removeReviewDocument,
  renameReviewTable,
  updateReviewColumn,
} from "@/server/review/manage-review-table";

/**
 * Server Actions des Rasters. Sie reichen das Ergebnis der Service-Funktionen
 * unverändert durch: `{ ok: true, … } | { ok: false, code }`. Der Client lädt
 * danach die Serverdaten einmal nach; im Takt des Live-Rasters passiert das nie.
 */
export type ReviewActionResult<T = object> = ({ ok: true } & T) | { ok: false; code: string };

export async function saveColumn(input: {
  reviewTableId: string;
  reviewColumnId?: string;
  column: ReviewColumnInput;
}): Promise<ReviewActionResult<{ reviewColumnId: string }>> {
  if (input.reviewColumnId) {
    const result = await updateReviewColumn({
      reviewTableId: input.reviewTableId,
      reviewColumnId: input.reviewColumnId,
      column: input.column,
    });
    return result.ok ? { ok: true, reviewColumnId: input.reviewColumnId } : result;
  }
  return addReviewColumn({ reviewTableId: input.reviewTableId, column: input.column });
}

export async function removeColumn(input: {
  reviewTableId: string;
  reviewColumnId: string;
}): Promise<ReviewActionResult> {
  return archiveReviewColumn(input);
}

export async function removeDocument(input: {
  reviewTableId: string;
  reviewDocumentId: string;
}): Promise<ReviewActionResult> {
  return removeReviewDocument(input);
}

export async function renameReview(input: {
  reviewTableId: string;
  name: string;
}): Promise<ReviewActionResult> {
  return renameReviewTable(input);
}

/**
 * Die Upload-Kette (`POST /api/uploads/policy` → Blob → `complete`) ist an einen
 * aktiven Entwurf gebunden. Die Vertragsprüfung leiht sich dafür den gebundenen
 * Entwurf des Nutzers oder legt einen mit dem ersten verfügbaren Rahmenwerk an;
 * das Rahmenwerk spielt für den Vertrag keine Rolle, nur die Bindung zählt.
 */
export async function prepareUploadDraft(input: {
  locale: string;
}): Promise<ReviewActionResult<{ draftId: string }>> {
  if (!hasLocale(routing.locales, input.locale)) return { ok: false, code: "REVIEW_INPUT_INVALID" };
  const existing = await getBoundActiveDraft();
  if (existing?.frameworkSlug) return { ok: true, draftId: existing.id };
  const frameworks = await listFrameworkCatalogue(input.locale);
  const framework = frameworks.find((entry) => entry.availability === "included") ?? frameworks[0];
  if (!framework) return { ok: false, code: "REVIEW_DOCUMENT_NOT_FOUND" };
  const selection = await persistFrameworkSelection(framework.id, input.locale);
  if (!selection.draftId) return { ok: false, code: "DATABASE_UNAVAILABLE" };
  return { ok: true, draftId: selection.draftId };
}

/** Übernimmt eine fertig aufbereitete Fassung aus dem Entwurf in die Prüfung. */
export async function addUploadedDocument(input: {
  reviewTableId: string;
  policyVersionId: string;
  draftId: string;
}): Promise<ReviewActionResult<{ reviewDocumentId: string }>> {
  return addReviewDocument(input);
}

/** Das mitgelieferte Beispieldokument, über denselben Entwurfsweg wie ein Upload. */
export async function addSampleDocument(input: {
  reviewTableId: string;
  locale: string;
}): Promise<ReviewActionResult<{ reviewDocumentId: string }>> {
  const draft = await prepareUploadDraft({ locale: input.locale });
  if (!draft.ok) return draft;
  let selection;
  try {
    selection = await selectSamplePolicy(draft.draftId);
  } catch {
    return { ok: false, code: "REVIEW_DOCUMENT_NOT_FOUND" };
  }
  if (!selection.policyVersionId) return { ok: false, code: "DATABASE_UNAVAILABLE" };
  return addReviewDocument({
    reviewTableId: input.reviewTableId,
    policyVersionId: selection.policyVersionId,
    draftId: draft.draftId,
  });
}
