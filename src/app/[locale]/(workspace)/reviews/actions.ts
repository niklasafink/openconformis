"use server";

import { hasLocale } from "next-intl";
import { redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { createReviewTable } from "@/server/review/manage-review-table";

/**
 * Legt eine Prüfung an und öffnet ihr Raster. Ein Fehler kommt als Ergebnis
 * zurück, damit das Formular ihn neben dem Feld zeigen kann.
 */
export async function createReview(input: {
  locale: string;
  name: string;
}): Promise<{ ok: false; code: string }> {
  if (!hasLocale(routing.locales, input.locale)) return { ok: false, code: "REVIEW_INPUT_INVALID" };
  const result = await createReviewTable({ name: input.name, locale: input.locale });
  if (!result.ok) return result;
  redirect(`/${input.locale}/reviews/${result.reviewTableId}`);
}
