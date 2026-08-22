"use server";

import { hasLocale } from "next-intl";
import { redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { selectSamplePolicy } from "@/server/policies/sample-service";

export async function chooseSamplePolicy(formData: FormData) {
  const locale = formData.get("locale");
  const draftId = formData.get("draft");

  if (typeof locale !== "string" || !hasLocale(routing.locales, locale)) {
    throw new Error("Invalid locale.");
  }

  const selection = await selectSamplePolicy(typeof draftId === "string" ? draftId : undefined);
  const query = new URLSearchParams({ source: selection.source });

  if (typeof draftId === "string" && draftId) query.set("draft", draftId);
  if (selection.policyVersionId) query.set("policy", selection.policyVersionId);

  redirect(`/${locale}/analyses/new/scope?${query.toString()}`);
}
