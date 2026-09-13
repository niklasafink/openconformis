import "server-only";

/** Entfernt Anführungszeichen, die beim Einfügen in Vercel oft mitkopiert werden. */
function unquote(value: string) {
  return value
    .trim()
    .replace(/^(["'])(.*)\1$/su, "$2")
    .trim();
}

/** Einzelner Umgebungswert ohne Leerraum und mitkopierte Anführungszeichen. */
export function configuredValue(name: string) {
  return unquote(process.env[name] ?? "");
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
