import "server-only";

/** Entfernt Anführungszeichen, die beim Einfügen in Vercel oft mitkopiert werden. */
function unquote(value: string) {
  return value
    .trim()
    .replace(/^(["'])(.*)\1$/su, "$2")
    .trim();
}

/**
 * Kommagetrennte Umgebungsliste als Menge; Leerraum, umschließende
 * Anführungszeichen und leere Einträge zählen nicht.
 */
export function configuredSet(name: string) {
  return new Set(
    unquote(process.env[name] ?? "")
      .split(",")
      .map(unquote)
      .filter(Boolean),
  );
}
