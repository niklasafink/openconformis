import { NextResponse } from "next/server";
import { z } from "zod";

import {
  archiveFrameworkRelease,
  createDraftFrameworkRelease,
  createRegulatoryFramework,
  publishFrameworkRelease,
  saveDraftRequirement,
} from "@/server/catalogue/admin-service";
import { listAdminCatalogue } from "@/server/catalogue/admin-query";
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  MembershipRequiredError,
} from "@/server/auth/session-principal";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";

const mutationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create_framework"), input: z.unknown() }),
  z.object({ operation: z.literal("create_release"), input: z.unknown() }),
  z.object({ operation: z.literal("save_requirement"), input: z.unknown() }),
  z.object({ operation: z.literal("publish_release"), releaseId: z.string().uuid() }),
  z.object({ operation: z.literal("archive_release"), releaseId: z.string().uuid() }),
]);

function adminError(error: unknown) {
  if (error instanceof z.ZodError)
    return NextResponse.json({ code: "INVALID_ADMIN_INPUT" }, { status: 400 });
  if (error instanceof AuthenticationRequiredError)
    return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (error instanceof AuthorizationDeniedError || error instanceof MembershipRequiredError)
    return NextResponse.json({ code: "ADMIN_REQUIRED" }, { status: 403 });
  if (error instanceof Error && /required|unknown|not_|only|draft|release/i.test(error.message))
    return NextResponse.json({ code: "ADMIN_CONFLICT" }, { status: 409 });
  return NextResponse.json({ code: "ADMIN_OPERATION_FAILED" }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json(
      { frameworks: await listAdminCatalogue() },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return adminError(error);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }
  try {
    const mutation = mutationSchema.parse(await request.json());
    const result =
      mutation.operation === "create_framework"
        ? await createRegulatoryFramework(mutation.input as never)
        : mutation.operation === "create_release"
          ? await createDraftFrameworkRelease(mutation.input as never)
          : mutation.operation === "save_requirement"
            ? await saveDraftRequirement(mutation.input as never)
            : mutation.operation === "publish_release"
              ? await publishFrameworkRelease(mutation.releaseId)
              : await archiveFrameworkRelease(mutation.releaseId);
    return NextResponse.json(result, {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return adminError(error);
  }
}
