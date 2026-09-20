"use server";

import { redirect } from "next/navigation";

import { hasLocale } from "next-intl";

import { analysisProfileSchema } from "@/domain/analysis/profile";
import { routing } from "@/i18n/routing";
import { institutionSizeSchema, persistDraftScope } from "@/server/drafts/scope-selection";

export async function saveScopeAndContinue(formData: FormData) {
  const localeValue = String(formData.get("locale") ?? "");
  if (!hasLocale(routing.locales, localeValue)) throw new Error("INVALID_LOCALE");

  const draftId = String(formData.get("draftId") ?? "");
  const institutionSize = institutionSizeSchema.parse(formData.get("institutionSize"));
  const analysisProfile = analysisProfileSchema.parse(formData.get("analysisProfile"));
  const organizationContext = String(formData.get("organizationContext") ?? "");
  const includedRequirementKeys = formData
    .getAll("includedRequirement")
    .map(String)
    .filter(Boolean);

  await persistDraftScope({
    expectedDraftId: draftId,
    institutionSize,
    analysisProfile,
    organizationContext,
    includedRequirementKeys,
  });

  redirect(`/${localeValue}/analyses/new/results?draft=${encodeURIComponent(draftId)}`);
}
