import { z } from "zod";

export const aiRouteProviderSchema = z.enum([
  "openrouter",
  "requesty",
  "anthropic",
  "google",
  "openai",
  "typesafe",
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
  typesafe: {
    label: "TypeSafe",
    credentialHelpUrl: "https://platform.typesafe.ai/keys",
  },
};

/**
 * Zweck eines kurzlebigen Schlüssels. Die Vertragsprüfung braucht **zwei** Werte,
 * nicht einen: der aktive Schlüssel ist über
 * `(ownerUserId, sessionId, provider, purpose, bindingId)` eindeutig
 * (`ai_credentials_active_binding_uidx`). Wählt jemand versehentlich denselben
 * Anbieter für Belegrouting und Eskalation, kollidierten beide Schlüssel bei
 * gleichem Zweck. Mit zwei Zwecken und derselben `bindingId = reviewRunId` bleibt
 * es konfliktfrei, ohne abgeleitete Bindungs-IDs.
 */
export const aiCredentialPurposeSchema = z.enum([
  "analysis",
  "chat",
  "review_routing",
  "review_escalation",
  // Jev als optionale Hilfe der Gap-Analyse. Ein eigener Zweck, damit der Schlüssel
  // weder mit dem Analyse-Schlüssel des Drafts noch mit einem Prüflauf kollidiert.
  "analysis_assist",
  // Einordnung von Fundstellen im Plausicheck der Offenlegungspflicht über das
  // Nutzermodell, gebunden an die Lauf-ID.
  "disclosure",
  // Jev (TypeSafe) ordnet im Plausicheck zuerst ein; eigener Zweck neben dem
  // Modellschlüssel desselben Laufs.
  "disclosure_assist",
]);

export type AiCredentialPurpose = z.infer<typeof aiCredentialPurposeSchema>;
