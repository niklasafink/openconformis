const firstDelayMs = 400;
const maximumDelayMs = 2_000;
const growth = 1.5;

/**
 * Wartezeit vor der nächsten Statusabfrage einer im Hintergrund verarbeiteten
 * Datei. Eine Word-Datei ist oft schon nach unter einer Sekunde zerlegt; ein
 * fester Zwei-Sekunden-Takt ließ den Nutzer dann grundlos warten. Der Abstand
 * wächst bis zur alten Obergrenze, damit lange laufende OCR-Läufe die
 * Datenbank nicht mit Abfragen fluten.
 */
export function nextProcessingPollDelay(attempt: number) {
  const exponent = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(maximumDelayMs, Math.round(firstDelayMs * growth ** exponent));
}
