import { NextResponse } from "next/server";
import { z } from "zod";

import {
  publishModelEvaluationSchema,
  listModelEvaluations,
  saveModelEvaluation,
  updateModelLifecycle,
} from "@/server/ai/evaluation-service";
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  MembershipRequiredError,
} from "@/server/auth/session-principal";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }
  try {
    const result = await saveModelEvaluation(
      publishModelEvaluationSchema.parse(await request.json()),
    );
    return NextResponse.json(result, {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ code: "INVALID_EVALUATION" }, { status: 400 });
    if (error instanceof AuthenticationRequiredError)
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    if (error instanceof AuthorizationDeniedError || error instanceof MembershipRequiredError)
      return NextResponse.json({ code: "ADMIN_REQUIRED" }, { status: 403 });
    if (error instanceof Error && error.message.startsWith("MODEL_"))
      return NextResponse.json({ code: error.message }, { status: 409 });
    return NextResponse.json({ code: "EVALUATION_FAILED" }, { status: 500 });
  }
}

export async function GET() {
  try {
    return NextResponse.json(
      { evaluations: await listModelEvaluations() },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError)
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    if (error instanceof AuthorizationDeniedError || error instanceof MembershipRequiredError)
      return NextResponse.json({ code: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json({ code: "EVALUATION_LIST_FAILED" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }
  try {
    return NextResponse.json(await updateModelLifecycle(await request.json()), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ code: "INVALID_MODEL_LIFECYCLE" }, { status: 400 });
    if (error instanceof AuthenticationRequiredError)
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    if (error instanceof AuthorizationDeniedError || error instanceof MembershipRequiredError)
      return NextResponse.json({ code: "ADMIN_REQUIRED" }, { status: 403 });
    if (error instanceof Error && error.message.startsWith("MODEL_"))
      return NextResponse.json({ code: error.message }, { status: 404 });
    return NextResponse.json({ code: "MODEL_LIFECYCLE_FAILED" }, { status: 500 });
  }
}
