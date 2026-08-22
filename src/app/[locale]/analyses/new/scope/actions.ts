"use server";

import { redirect } from "next/navigation";

import { hasLocale } from "next-intl";

import { routing } from "@/i18n/routing";
import { institutionSizeSchema, persistDraftScope } from "@/server/drafts/scope-selection";

export async function saveScopeAndContinue(formData: FormData) {
  const localeValue = String(formData.get("locale") ?? "");
  if (!hasLocale(routing.locales, localeValue)) throw new Error("INVALID_LOCALE");

  const draftId = String(formData.get("draftId") ?? "");
  const institutionSize = institutionSizeSchema.parse(formData.get("institutionSize"));
  const organizationContext = String(formData.get("organizationContext") ?? "");
  const includedRequirementKeys = formData
    .getAll("includedRequirement")
    .map(String)
    .filter(Boolean);
  const modelProfileId = String(formData.get("modelProfileId") ?? "");
  const modelCatalogueVersion = String(formData.get("modelCatalogueVersion") ?? "");
  const unevaluatedWarningAccepted = formData.get("unevaluatedWarningAccepted") === "true";

  await persistDraftScope({
    expectedDraftId: draftId,
    institutionSize,
    organizationContext,
    includedRequirementKeys,
    modelProfileId,
    modelCatalogueVersion,
    unevaluatedWarningAccepted,
  });

  redirect(`/${localeValue}/analyses/new/results?draft=${encodeURIComponent(draftId)}`);
}
