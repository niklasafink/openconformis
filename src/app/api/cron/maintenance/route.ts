import { NextResponse } from "next/server";

import { expireTemporaryCredentials } from "@/server/ai/credential-cleanup";
import { purgeExpiredAiData } from "@/server/maintenance/ai-retention";
import { purgeExpiredPolicyData } from "@/server/maintenance/policy-retention";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  const [credentials, ai, policies] = await Promise.all([
    expireTemporaryCredentials(),
    purgeExpiredAiData(),
    purgeExpiredPolicyData(),
  ]);
  return NextResponse.json(
    { status: "ok", credentials, ai, policies },
    { headers: { "cache-control": "private, no-store" } },
  );
}
