"use server";

import { hasLocale } from "next-intl";
import { redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { persistFrameworkSelection } from "@/server/drafts/framework-selection";

export async function continueFromFramework(formData: FormData) {
  const locale = formData.get("locale");
  const frameworkId = formData.get("framework");

  if (
    typeof locale !== "string" ||
    !hasLocale(routing.locales, locale) ||
    typeof frameworkId !== "string"
  ) {
    throw new Error("Invalid framework selection.");
  }

  const selection = await persistFrameworkSelection(frameworkId, locale);
  const query = new URLSearchParams({ framework: selection.frameworkId });

  if (selection.draftId) {
    query.set("draft", selection.draftId);
  }

  redirect(`/${locale}/analyses/new/policy?${query.toString()}`);
}
