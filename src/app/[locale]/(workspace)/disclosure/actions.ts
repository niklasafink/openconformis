"use server";

import { hasLocale } from "next-intl";
import { redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { createDisclosureCase } from "@/server/disclosure/manage-case";

/** Legt eine Prüfung an und öffnet ihren Plausicheck. */
export async function createCase(input: {
  locale: string;
  title: string;
}): Promise<{ ok: false; code: string }> {
  if (!hasLocale(routing.locales, input.locale))
    return { ok: false, code: "DISCLOSURE_INPUT_INVALID" };
  const result = await createDisclosureCase({ title: input.title });
  if (!result.ok) return result;
  redirect(`/${input.locale}/disclosure/${result.caseId}/plausibility`);
}
