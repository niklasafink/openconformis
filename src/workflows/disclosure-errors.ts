/**
 * Regeln beider Workflows der Offenlegungspflicht für den Workflow-Körper, ohne
 * Server-Importe (Workflow-Funktionen dürfen keine Node.js-Module laden). Was einen
 * Schritt sofort beendet, steht in `src/server/disclosure/workflow-errors.ts`.
 */

/**
 * Ohne gültigen Schlüssel oder Route kann kein weiterer Batch gelingen: dann endet der
 * ganze Lauf mit dem Grund. Eine einzelne unbrauchbare Antwort ist dagegen eine Lücke.
 */
export const runEndingCodes =
  /^(?:BYOK_|ANALYSIS_CREDENTIAL_MISSING|DISCLOSURE_CREDENTIAL_EXPIRED|PROVIDER_CREDENTIAL_INVALID|INVALID_PROVIDER_ROUTE|PROVIDER_ROUTE)/u;

export function codeOf(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0]!.trim();
  return /^[A-Z_]+$/u.test(code) ? code : "DISCLOSURE_RUN_FAILED";
}
