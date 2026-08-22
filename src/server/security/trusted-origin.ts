import "server-only";

export function hasTrustedApplicationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin || !configuredOrigin) return process.env.NODE_ENV !== "production";

  try {
    return new URL(origin).origin === new URL(configuredOrigin).origin;
  } catch {
    return false;
  }
}
