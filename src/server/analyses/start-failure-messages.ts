import "server-only";

/**
 * Erklärt jeden Startfehler in einem Satz, der dem Nutzer sagt, was zu tun ist.
 *
 * Ohne diese Zuordnung endete jeder nicht eigens behandelte Fall in „Die Analyse
 * konnte nicht gestartet werden" — eine Meldung, die weder Ursache noch nächsten
 * Schritt nennt. Die Texte beschreiben nur den fachlichen Zustand; sie enthalten
 * keine internen Details, keine Schlüssel und keine Policy-Inhalte.
 */
const startFailureMessages: Record<string, string> = {
  DATABASE_UNAVAILABLE:
    "Die Datenbank ist nicht erreichbar. Bitte versuchen Sie es in einigen Minuten erneut.",
  SPONSORED_RUNS_DISABLED:
    "Kostenlose Läufe sind auf dieser Instanz nicht aktiviert. Hinterlegen Sie einen eigenen API-Schlüssel.",
  SPONSORED_ROUTE_NOT_CONFIGURED:
    "Die gesponserte Modellroute ist unvollständig konfiguriert. Das muss in der Umgebung behoben werden.",
  SPONSORED_MODEL_NOT_ALLOWED:
    "Das konfigurierte Modell steht für gesponserte Läufe nicht auf der Freigabeliste.",
  DRAFT_NOT_FOUND:
    "Der Analyseentwurf wurde nicht gefunden. Beginnen Sie den Ablauf noch einmal bei der Rahmenwerkauswahl.",
  DRAFT_NOT_ACTIVE:
    "Dieser Entwurf ist abgelaufen. Beginnen Sie den Ablauf noch einmal bei der Rahmenwerkauswahl.",
  DRAFT_ALREADY_CLAIMED:
    "Für diesen Entwurf läuft bereits eine Analyse. Öffnen Sie sie über Ihre Analyseübersicht.",
  FRAMEWORK_RELEASE_NOT_FOUND:
    "Für das gewählte Rahmenwerk ist keine veröffentlichte Fassung hinterlegt.",
  SCOPE_RELEASE_MISMATCH:
    "Das Rahmenwerk wurde geändert, seit Sie den Prüfungsumfang festgelegt haben. Bitte legen Sie ihn erneut fest.",
  SCOPE_INVALID: "Der Prüfungsumfang ist unvollständig. Bitte legen Sie ihn erneut fest.",
  POLICY_NOT_READY:
    "Das Dokument ist noch nicht fertig verarbeitet. Warten Sie einen Moment und versuchen Sie es erneut.",
  BYOK_REQUIRED:
    "Ihr kostenloser Lauf ist aufgebraucht. Hinterlegen Sie einen eigenen API-Schlüssel, um fortzufahren.",
  BYOK_CREDENTIAL_REQUIRED: "Für diesen Lauf fehlt der hinterlegte Modellzugang.",
  MODEL_SELECTION_NOT_FOUND:
    "Es wurde kein Modell ausgewählt. Bitte legen Sie den Prüfungsumfang erneut fest.",
  AUTHENTICATION_REQUIRED: "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
  VERIFIED_EMAIL_REQUIRED:
    "Ihre E-Mail-Adresse ist noch nicht bestätigt. Öffnen Sie den Bestätigungslink aus der E-Mail.",
  MEMBERSHIP_REQUIRED:
    "Ihr Arbeitsbereich konnte nicht ermittelt werden. Melden Sie sich erneut an.",
  UNTRUSTED_ORIGIN: "Die Anfrage kam von einer nicht vertrauenswürdigen Adresse.",
  INVALID_ANALYSIS_START: "Die Anfrage war unvollständig. Bitte laden Sie die Seite neu.",
};

export function describeStartFailure(code: string): string | undefined {
  return startFailureMessages[code];
}
