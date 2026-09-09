export type AuthFailure =
  "generic" | "accountExists" | "invalidCredentials" | "passwordTooShort" | "tooManyAttempts";

/**
 * Übersetzt den Fehler des Anbieters in einen Fall, den der Nutzer selbst
 * auflösen kann. Ohne diese Zuordnung sah jemand, der sich mit einer bereits
 * registrierten Adresse anmelden wollte, nur „Die Anmeldung konnte nicht
 * abgeschlossen werden." — ohne den einen Hinweis, der weitergeholfen hätte.
 *
 * Der Client wirft `AuthApiError` und führt dort nur einen groben `code`
 * ("validation_failed"); der genaue Grund steht ausschließlich in der Meldung.
 * Deshalb wird beides ausgewertet. Die Meldungen sind englische Anbietertexte —
 * `classifyAuthFailure` ist exportiert, damit diese Abhängigkeit getestet ist und
 * ein Formulierungswechsel beim Anbieter nicht still zur Sackgasse zurückführt.
 *
 * Eigene, importfreie Datei: ein Unit-Test lädt nur diese reine Funktion, ohne
 * `next-intl`/`next/navigation` über die Formularkomponente mitzuziehen.
 */
export function classifyAuthFailure(error: unknown): AuthFailure {
  const shape = (error ?? {}) as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof shape.code === "string" ? shape.code.toUpperCase() : "";
  const message = typeof shape.message === "string" ? shape.message.toLowerCase() : "";
  const status = typeof shape.status === "number" ? shape.status : undefined;

  if (code.includes("USER_ALREADY_EXISTS") || message.includes("already exists")) {
    return "accountExists";
  }
  if (
    code.includes("INVALID_EMAIL_OR_PASSWORD") ||
    message.includes("invalid email or password") ||
    message.includes("invalid password")
  ) {
    return "invalidCredentials";
  }
  if (
    message.includes("password") &&
    (message.includes("too short") || message.includes("at least") || message.includes("too long"))
  ) {
    return "passwordTooShort";
  }
  if (status === 429 || message.includes("too many")) return "tooManyAttempts";
  if (status === 401) return "invalidCredentials";
  return "generic";
}
