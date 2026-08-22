import "server-only";

import type { AiRouteProvider } from "@/domain/ai/provider";

import type { ChatProviderConfiguration } from "./chat-provider-configuration";

export type ChatHistoryMessage = { role: "user" | "assistant"; content: string };
export type ChatStreamResult = {
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
};

export class ChatModelError extends Error {
  constructor(
    public readonly code:
      | "CHAT_PROVIDER_REJECTED"
      | "CHAT_PROVIDER_UNAVAILABLE"
      | "CHAT_RESPONSE_INVALID"
      | "CHAT_OUTPUT_LIMIT",
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "ChatModelError";
  }
}

type StreamRequest = {
  configuration: ChatProviderConfiguration;
  apiKey: string;
  modelId: string;
  system: string;
  messages: ChatHistoryMessage[];
  signal?: AbortSignal;
};

const MAX_STREAM_BYTES = 2_000_000;

async function* ssePayloads(response: Response) {
  if (!response.ok) {
    throw new ChatModelError(
      response.status === 429 || response.status >= 500
        ? "CHAT_PROVIDER_UNAVAILABLE"
        : "CHAT_PROVIDER_REJECTED",
      response.status === 429 || response.status >= 500,
    );
  }
  if (!response.body) throw new ChatModelError("CHAT_RESPONSE_INVALID", false);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > MAX_STREAM_BYTES) {
      await reader.cancel();
      throw new ChatModelError("CHAT_OUTPUT_LIMIT", false);
    }
    buffer += decoder.decode(result.value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/u);
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") yield data;
    }
  }
  const trailing = buffer
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (trailing && trailing !== "[DONE]") yield trailing;
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new ChatModelError("CHAT_RESPONSE_INVALID", false);
  }
}

function combineSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(120_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function responseHeaders(provider: AiRouteProvider, apiKey: string): Record<string, string> {
  return provider === "anthropic"
    ? {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": apiKey,
      }
    : provider === "google"
      ? { "content-type": "application/json", "x-goog-api-key": apiKey }
      : { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
}

function openAiInput(messages: ChatHistoryMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: [
      { type: message.role === "assistant" ? "output_text" : "input_text", text: message.content },
    ],
  }));
}

function providerRequest(input: StreamRequest) {
  const { provider, baseUrl, maxOutputTokens } = input.configuration;
  if (provider === "openai" || provider === "requesty") {
    return {
      url: `${baseUrl}/responses`,
      body: {
        model: input.modelId,
        instructions: input.system,
        input: openAiInput(input.messages),
        max_output_tokens: maxOutputTokens,
        store: false,
        stream: true,
      },
    };
  }
  if (provider === "anthropic") {
    return {
      url: `${baseUrl}/messages`,
      body: {
        model: input.modelId,
        system: input.system,
        messages: input.messages,
        max_tokens: maxOutputTokens,
        temperature: 0,
        stream: true,
      },
    };
  }
  if (provider === "google") {
    const model = input.modelId.replace(/^models\//u, "");
    if (!model || model.includes("/")) throw new ChatModelError("CHAT_PROVIDER_REJECTED", false);
    return {
      url: `${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      body: {
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: { temperature: 0, maxOutputTokens },
      },
    };
  }
  const providerOnly = (process.env.OPENROUTER_CHAT_PROVIDER_ONLY ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (providerOnly.length === 0) throw new ChatModelError("CHAT_PROVIDER_UNAVAILABLE", false);
  return {
    url: `${baseUrl}/chat/completions`,
    body: {
      model: input.modelId,
      messages: [{ role: "system", content: input.system }, ...input.messages],
      temperature: 0,
      max_tokens: maxOutputTokens,
      stream: true,
      stream_options: { include_usage: true },
      provider: {
        only: providerOnly,
        allow_fallbacks: false,
        data_collection: "deny",
        zdr: true,
      },
    },
  };
}

export async function* streamChatModel(
  input: StreamRequest,
  fetchImplementation: typeof fetch = fetch,
): AsyncGenerator<string, ChatStreamResult> {
  const request = providerRequest(input);
  let response: Response;
  try {
    response = await fetchImplementation(request.url, {
      method: "POST",
      headers: responseHeaders(input.configuration.provider, input.apiKey),
      body: JSON.stringify(request.body),
      signal: combineSignal(input.signal),
    });
  } catch {
    throw new ChatModelError("CHAT_PROVIDER_UNAVAILABLE", true);
  }
  const metadata: ChatStreamResult = {
    providerRequestId: response.headers.get("x-request-id") ?? undefined,
  };
  for await (const raw of ssePayloads(response)) {
    const event = safeJson(raw);
    const provider = input.configuration.provider;
    let delta = "";
    if (provider === "openrouter") {
      const choices = event.choices as Array<{ delta?: { content?: string } }> | undefined;
      delta = choices?.[0]?.delta?.content ?? "";
      const usage = event.usage as
        | {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          }
        | undefined;
      metadata.providerRequestId = (event.id as string | undefined) ?? metadata.providerRequestId;
      metadata.inputTokens = usage?.prompt_tokens ?? metadata.inputTokens;
      metadata.outputTokens = usage?.completion_tokens ?? metadata.outputTokens;
      metadata.cachedInputTokens =
        usage?.prompt_tokens_details?.cached_tokens ?? metadata.cachedInputTokens;
    } else if (provider === "anthropic") {
      const deltaObject = event.delta as { type?: string; text?: string } | undefined;
      if (event.type === "content_block_delta" && deltaObject?.type === "text_delta") {
        delta = deltaObject.text ?? "";
      }
      const message = event.message as
        { id?: string; usage?: { input_tokens?: number } } | undefined;
      const usage = event.usage as { output_tokens?: number } | undefined;
      metadata.providerRequestId = message?.id ?? metadata.providerRequestId;
      metadata.inputTokens = message?.usage?.input_tokens ?? metadata.inputTokens;
      metadata.outputTokens = usage?.output_tokens ?? metadata.outputTokens;
    } else if (provider === "google") {
      const candidates = event.candidates as
        Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
      delta = candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      const usage = event.usageMetadata as
        | {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            cachedContentTokenCount?: number;
          }
        | undefined;
      metadata.providerRequestId =
        (event.responseId as string | undefined) ?? metadata.providerRequestId;
      metadata.inputTokens = usage?.promptTokenCount ?? metadata.inputTokens;
      metadata.outputTokens = usage?.candidatesTokenCount ?? metadata.outputTokens;
      metadata.cachedInputTokens = usage?.cachedContentTokenCount ?? metadata.cachedInputTokens;
    } else {
      if (event.type === "response.output_text.delta")
        delta = (event.delta as string | undefined) ?? "";
      if (event.type === "response.created" || event.type === "response.completed") {
        const createdResponse = event.response as
          | {
              id?: string;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                input_tokens_details?: { cached_tokens?: number };
              };
            }
          | undefined;
        metadata.providerRequestId = createdResponse?.id ?? metadata.providerRequestId;
        metadata.inputTokens = createdResponse?.usage?.input_tokens ?? metadata.inputTokens;
        metadata.outputTokens = createdResponse?.usage?.output_tokens ?? metadata.outputTokens;
        metadata.cachedInputTokens =
          createdResponse?.usage?.input_tokens_details?.cached_tokens ?? metadata.cachedInputTokens;
      }
    }
    if (delta) yield delta;
  }
  return metadata;
}
