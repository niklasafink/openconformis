import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AuthenticationRequiredError,
  MembershipRequiredError,
} from "@/server/auth/session-principal";
import { ChatServiceError, getChatThreadMessages } from "@/server/chat/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const { threadId: value } = await context.params;
    const threadId = z.uuid().parse(value);
    return NextResponse.json(await getChatThreadMessages(threadId), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    if (error instanceof MembershipRequiredError) {
      return NextResponse.json({ code: "MEMBERSHIP_REQUIRED" }, { status: 403 });
    }
    if (error instanceof ChatServiceError) {
      return NextResponse.json({ code: error.code }, { status: 404 });
    }
    return NextResponse.json({ code: "INVALID_CHAT_THREAD" }, { status: 400 });
  }
}
