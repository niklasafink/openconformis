import "server-only";

export function hasTrustedApplicationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin || !configuredOrigin) return process.env.NODE_ENV !== "production";

  try {
    const requestUrl = new URL(origin);
    const configuredUrl = new URL(configuredOrigin);
    if (requestUrl.origin === configuredUrl.origin) return true;

    // In Produktion bleibt der Origin exakt. Lokal weicht `next dev` auf den
    // nächsten freien Port aus, sobald der konfigurierte belegt ist; die eigenen
    // Aufrufe kämen dann von `localhost:3001` statt `localhost:3000` und würden
    // als fremde Herkunft abgewiesen — jeder Upload und jeder Start mit 403.
    // Der Port trennt keine Herkunft, die der Hostname nicht schon trennt.
    return process.env.NODE_ENV !== "production" && requestUrl.hostname === configuredUrl.hostname;
  } catch {
    return false;
  }
}
