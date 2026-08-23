import { NextResponse } from "next/server";

import { ChatModelError } from "@/server/ai/chat-stream";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";
import {
  AuthenticationRequiredError,
  MembershipRequiredError,
} from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { ChatServiceError, executeChatTurn } from "@/server/chat/service";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";
import {
  assertRequestSize,
  enforceRequestRateLimit,
  requestProtectionResponse,
} from "@/server/security/request-protection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const encoder = new TextEncoder();

function event(name: string, payload: unknown) {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function safeCode(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return "AUTHENTICATION_REQUIRED";
  if (error instanceof MembershipRequiredError) return "MEMBERSHIP_REQUIRED";
  if (error instanceof VerifiedEmailRequiredError) return "VERIFIED_EMAIL_REQUIRED";
  if (error instanceof ChatServiceError) return error.code;
  if (error instanceof ChatModelError) return error.code;
  if (error instanceof TemporaryCredentialError) return error.code;
  return "CHAT_FAILED";
}

export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }
  let input: unknown;
  try {
    assertRequestSize(request, 64_000);
    await enforceRequestRateLimit(request, { bucket: "chat-stream", limit: 30, windowSeconds: 60 });
    input = await request.json();
  } catch (error) {
    const protectedResponse = requestProtectionResponse(error);
    if (protectedResponse) return protectedResponse;
    return NextResponse.json({ code: "INVALID_CHAT_INPUT" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void executeChatTurn(
        input,
        {
          onSources(sources) {
            controller.enqueue(
              event(
                "sources",
                sources.map((source) => ({
                  citationOrder: source.citationOrder,
                  sourceType: source.sourceType,
                  label: source.label,
                  locator: source.locator,
                })),
              ),
            );
          },
          onDelta(delta) {
            controller.enqueue(event("delta", { delta }));
          },
          onFinal(result) {
            controller.enqueue(event("final", result));
          },
        },
        request.signal,
      )
        .catch((error: unknown) => controller.enqueue(event("error", { code: safeCode(error) })))
        .finally(() => controller.close());
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "private, no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
