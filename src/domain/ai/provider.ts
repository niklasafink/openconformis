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
  { label: string; credentialHelpUrl: string }
> = {
  openrouter: {
    label: "OpenRouter",
    credentialHelpUrl: "https://openrouter.ai/settings/keys",
  },
  requesty: {
    label: "Requesty",
    credentialHelpUrl: "https://app.requesty.ai",
  },
  anthropic: {
    label: "Anthropic",
    credentialHelpUrl: "https://console.anthropic.com/settings/keys",
  },
  google: {
    label: "Google",
    credentialHelpUrl: "https://aistudio.google.com/app/apikey",
  },
  openai: {
    label: "OpenAI",
    credentialHelpUrl: "https://platform.openai.com/api-keys",
  },
};

export const aiCredentialPurposeSchema = z.enum(["analysis", "chat"]);

export type AiCredentialPurpose = z.infer<typeof aiCredentialPurposeSchema>;
