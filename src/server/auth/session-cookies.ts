type ParsedSetCookie = {
  name: string;
  value: string;
  expired: boolean;
};

function parseCookieHeader(header: string) {
  const cookies = new Map<string, string>();

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    if (name) cookies.set(name, pair.slice(separator + 1).trim());
  }

  return cookies;
}

/**
 * Liest Name, Wert und die Frage „löscht dieses Cookie?" aus einem
 * `Set-Cookie`-Header. Werte bleiben unverändert — sie wandern unangetastet in
 * den Cookie-Header zurück, statt einmal dekodiert und neu kodiert zu werden.
 */
function parseSetCookie(header: string, now: Date): ParsedSetCookie | null {
  const [pair, ...attributes] = header.split(";");
  const separator = pair?.indexOf("=") ?? -1;
  if (!pair || separator < 1) return null;

  const name = pair.slice(0, separator).trim();
  if (!name) return null;

  let maxAge: number | undefined;
  let expiresAt: number | undefined;

  for (const attribute of attributes) {
    const attributeSeparator = attribute.indexOf("=");
    const key = (attributeSeparator === -1 ? attribute : attribute.slice(0, attributeSeparator))
      .trim()
      .toLowerCase();
    const value = attributeSeparator === -1 ? "" : attribute.slice(attributeSeparator + 1).trim();

    if (key === "max-age") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) maxAge = parsed;
    } else if (key === "expires") {
      const parsed = new Date(value).getTime();
      if (!Number.isNaN(parsed)) expiresAt = parsed;
    }
  }

  // `Max-Age` hat Vorrang vor `Expires` (RFC 6265). Ein gelöschtes Cookie
  // erkennt man an `Max-Age=0` oder einem Ablaufdatum in der Vergangenheit.
  const expired =
    maxAge !== undefined ? maxAge <= 0 : expiresAt !== undefined && expiresAt <= now.getTime();

  return { name, value: pair.slice(separator + 1).trim(), expired };
}

/**
 * Führt aufgefrischte Cookies aus `Set-Cookie`-Headern in den Cookie-Header
 * derselben Anfrage ein.
 *
 * Der Browser erfährt von einem erneuerten Sitzungscookie erst bei der nächsten
 * Anfrage. Die Seite, die in genau dieser Anfrage gerendert wird, braucht den
 * neuen Stand aber sofort — sonst arbeitet sie mit einem Sitzungsstand, den der
 * Auth-Dienst gerade ersetzt hat.
 */
export function mergeRefreshedCookieHeader(
  cookieHeader: string,
  setCookieHeaders: readonly string[],
  now: Date = new Date(),
) {
  const cookies = parseCookieHeader(cookieHeader);

  for (const header of setCookieHeaders) {
    const parsed = parseSetCookie(header, now);
    if (!parsed) continue;
    if (parsed.expired) cookies.delete(parsed.name);
    else cookies.set(parsed.name, parsed.value);
  }

  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
}
