import "server-only";

import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import { db, isDatabaseConfigured } from "@/server/db/client";
import { rateLimitWindows } from "@/server/db/schema/jobs";

export class RequestProtectionError extends Error {
  constructor(
    public readonly code: "REQUEST_TOO_LARGE" | "RATE_LIMITED" | "BOT_CHECK_FAILED",
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "RequestProtectionError";
  }
}

function requestAddress(request: Request) {
  if (process.env.VERCEL === "1") {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  }
  if (process.env.TRUST_CLOUDFLARE_PROXY === "true") {
    return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  }
  return process.env.NODE_ENV === "production" ? "unknown" : "local-development";
}

function subjectHash(request: Request) {
  const secret = process.env.ABUSE_HASH_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error("ABUSE_HASH_SECRET_MISSING");
    return createHmac("sha256", "local-only").update(requestAddress(request)).digest("hex");
  }
  return createHmac("sha256", secret).update(requestAddress(request)).digest("hex");
}

/**
 * Grenzt JSON-Anfragen der Größe nach ein.
 *
 * Ein fehlender `content-length` wird abgelehnt statt als 0 gelesen: ohne diesen
 * Header — etwa bei `Transfer-Encoding: chunked` — ließe sich die Grenze sonst
 * vollständig umgehen. Alle Aufrufer sind JSON-Endpunkte, deren Clients den
 * Header setzen; Datei-Uploads laufen über einen anderen Weg.
 */
export function assertRequestSize(request: Request, maximumBytes: number) {
  const header = request.headers.get("content-length");
  if (header === null) throw new RequestProtectionError("REQUEST_TOO_LARGE");

  const length = Number.parseInt(header, 10);
  if (!Number.isFinite(length) || length < 0 || length > maximumBytes) {
    throw new RequestProtectionError("REQUEST_TOO_LARGE");
  }
}

export async function enforceRequestRateLimit(
  request: Request,
  input: { bucket: string; limit: number; windowSeconds: number },
) {
  if (!isDatabaseConfigured && process.env.NODE_ENV !== "production") return;
  const now = Date.now();
  const windowMilliseconds = input.windowSeconds * 1000;
  const windowStartedAt = new Date(Math.floor(now / windowMilliseconds) * windowMilliseconds);
  const expiresAt = new Date(windowStartedAt.getTime() + windowMilliseconds * 2);
  const [result] = await db
    .insert(rateLimitWindows)
    .values({
      bucket: input.bucket,
      subjectHash: subjectHash(request),
      windowStartedAt,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [
        rateLimitWindows.bucket,
        rateLimitWindows.subjectHash,
        rateLimitWindows.windowStartedAt,
      ],
      set: { requestCount: sql`${rateLimitWindows.requestCount} + 1` },
    })
    .returning({ requestCount: rateLimitWindows.requestCount });

  if ((result?.requestCount ?? input.limit + 1) > input.limit) {
    throw new RequestProtectionError(
      "RATE_LIMITED",
      Math.max(1, Math.ceil((windowStartedAt.getTime() + windowMilliseconds - now) / 1000)),
    );
  }
}

export async function verifyTurnstileToken(token: string | undefined) {
  if (process.env.TURNSTILE_ENFORCED !== "true") return;
  const verifyUrl = process.env.TURNSTILE_SITEVERIFY_WORKER_URL?.trim();
  if (!verifyUrl || !token) throw new RequestProtectionError("BOT_CHECK_FAILED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    let response: Response;
    try {
      response = await fetch(verifyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      // Ein nicht erreichbarer oder zu langsamer Prüfdienst ist kein interner
      // Anwendungsfehler. Die Prüfung schlägt geschlossen fehl und der Aufrufer
      // bekommt denselben klaren Code wie bei einem ungültigen Token, statt einer
      // 500 ohne Aussage.
      throw new RequestProtectionError("BOT_CHECK_FAILED");
    }

    const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
    if (!response.ok || result?.success !== true)
      throw new RequestProtectionError("BOT_CHECK_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}

export function requestProtectionResponse(error: unknown) {
  if (!(error instanceof RequestProtectionError)) return null;
  const status =
    error.code === "REQUEST_TOO_LARGE" ? 413 : error.code === "RATE_LIMITED" ? 429 : 403;
  return Response.json(
    { code: error.code },
    {
      status,
      headers: error.retryAfterSeconds
        ? { "retry-after": String(error.retryAfterSeconds), "cache-control": "no-store" }
        : { "cache-control": "no-store" },
    },
  );
}
