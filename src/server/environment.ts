import "server-only";

/** Kommagetrennte Umgebungsliste als Menge; Leerraum und leere Einträge zählen nicht. */
export function configuredSet(name: string) {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}
