import { z } from "zod";

export const aiRouteProviderSchema = z.enum([
  "openrouter",
  "requesty",
  "anthropic",
  "google",
  "openai",
]);

export type AiRouteProvider = z.infer<typeof aiRouteProviderSchema>;

export const aiProviderPublicDetails: Record<
  AiRouteProvider,
  { label: string; credentialHelpUrl: string; privacyAttestationRequired: boolean }
> = {
  openrouter: {
    label: "OpenRouter",
    credentialHelpUrl: "https://openrouter.ai/settings/keys",
    privacyAttestationRequired: false,
  },
  requesty: {
    label: "Requesty",
    credentialHelpUrl: "https://app.requesty.ai",
    privacyAttestationRequired: true,
  },
  anthropic: {
    label: "Anthropic",
    credentialHelpUrl: "https://console.anthropic.com/settings/keys",
    privacyAttestationRequired: true,
  },
  google: {
    label: "Google",
    credentialHelpUrl: "https://aistudio.google.com/app/apikey",
    privacyAttestationRequired: true,
  },
  openai: {
    label: "OpenAI",
    credentialHelpUrl: "https://platform.openai.com/api-keys",
    privacyAttestationRequired: true,
  },
};

export const aiCredentialPurposeSchema = z.enum(["analysis", "chat"]);

export type AiCredentialPurpose = z.infer<typeof aiCredentialPurposeSchema>;
