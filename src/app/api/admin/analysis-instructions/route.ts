import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listAnalysisInstructions,
  saveAnalysisInstruction,
  updateAnalysisInstructionStatus,
} from "@/server/ai/analysis-instruction-service";
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  MembershipRequiredError,
} from "@/server/auth/session-principal";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";

function instructionError(error: unknown) {
  if (error instanceof z.ZodError)
    return NextResponse.json({ code: "INVALID_INSTRUCTION" }, { status: 400 });
  if (error instanceof AuthenticationRequiredError)
    return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (error instanceof AuthorizationDeniedError || error instanceof MembershipRequiredError)
    return NextResponse.json({ code: "ADMIN_REQUIRED" }, { status: 403 });
  if (error instanceof Error && error.message.startsWith("INSTRUCTION_"))
    return NextResponse.json({ code: error.message }, { status: 409 });
  return NextResponse.json({ code: "INSTRUCTION_OPERATION_FAILED" }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json(
      { instructions: await listAnalysisInstructions() },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return instructionError(error);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request))
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  try {
    return NextResponse.json(await saveAnalysisInstruction(await request.json()), {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return instructionError(error);
  }
}

export async function PATCH(request: Request) {
  if (!hasTrustedApplicationOrigin(request))
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  try {
    return NextResponse.json(await updateAnalysisInstructionStatus(await request.json()), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return instructionError(error);
  }
}
