import { NextResponse } from "next/server";

import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  MembershipRequiredError,
} from "@/server/auth/session-principal";
import { getAdminOperationsSnapshot } from "@/server/operations/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAdminOperationsSnapshot(), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError)
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    if (error instanceof AuthorizationDeniedError || error instanceof MembershipRequiredError)
      return NextResponse.json({ code: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json({ code: "OPERATIONS_UNAVAILABLE" }, { status: 503 });
  }
}
