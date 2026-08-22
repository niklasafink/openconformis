import "server-only";

import type { AiRouteProvider } from "@/domain/ai/provider";

export type ChatProviderConfiguration = {
  provider: AiRouteProvider;
  baseUrl: string;
  maxOutputTokens: number;
  privacyProfileId: string;
};

export class ChatProviderConfigurationError extends Error {
  constructor(public readonly code: "CHAT_PROVIDER_UNAVAILABLE" | "TOKEN_LIMIT_INVALID") {
    super(code);
    this.name = "ChatProviderConfigurationError";
  }
}

function maxOutputTokens() {
  const value = Number.parseInt(process.env.BYOK_CHAT_MAX_OUTPUT_TOKENS?.trim() || "2000", 10);
  if (!Number.isInteger(value) || value < 128 || value > 16_000) {
    throw new ChatProviderConfigurationError("TOKEN_LIMIT_INVALID");
  }
  return value;
}

export function getChatProviderConfiguration(provider: AiRouteProvider): ChatProviderConfiguration {
  const baseUrl =
    provider === "openrouter"
      ? process.env.OPENROUTER_EU_BASE_URL?.trim()
      : provider === "requesty"
        ? process.env.REQUESTY_CHAT_BASE_URL?.trim() || "https://router.eu.requesty.ai/v1"
        : provider === "openai"
          ? process.env.OPENAI_CHAT_BASE_URL?.trim() || "https://eu.api.openai.com/v1"
          : provider === "anthropic"
            ? process.env.ANTHROPIC_CHAT_BASE_URL?.trim() || "https://api.anthropic.com/v1"
            : process.env.GOOGLE_CHAT_BASE_URL?.trim() ||
              "https://generativelanguage.googleapis.com/v1beta";
  if (!baseUrl) throw new ChatProviderConfigurationError("CHAT_PROVIDER_UNAVAILABLE");
  return {
    provider,
    baseUrl: baseUrl.replace(/\/$/u, ""),
    maxOutputTokens: maxOutputTokens(),
    privacyProfileId: process.env.BYOK_CHAT_PRIVACY_PROFILE_ID?.trim() || "byok-session-v1",
  };
}
