import "server-only";

import {
  parseAnalysisJevAssistMode,
  type AnalysisJevAssistMode,
} from "@/domain/analysis/jev-assist";

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

export type ReviewDecisionEngine = "jev" | "model";

/**
 * Wer in der Vertragsprüfung die Zellen entscheidet. `jev` ist der Standard;
 * `model` ist der Rückweg ohne TypeSafe-Konto: dasselbe Raster läuft vollständig über
 * das große BYOK-Modell. Der Wert wird beim Start je Lauf eingefroren — eine später
 * geänderte Umgebung ändert nie die Herkunft bereits erzeugter Antworten.
 *
 * Ein unbekannter Wert ist ein Konfigurationsfehler und kein stiller Rückfall auf den
 * Standard: sonst liefe ein Betreiber, der `Model` oder `off` tippt, unbemerkt über Jev.
 */
export function reviewDecisionEngine(): ReviewDecisionEngine {
  const value = configuredValue("REVIEW_DECISION_ENGINE").toLowerCase();
  if (!value) return "jev";
  if (value === "jev" || value === "model") return value;
  throw new Error("REVIEW_DECISION_ENGINE must be jev or model.");
}

/**
 * Wie weit Jev der Gap-Analyse hilft. `off` ist der Standard und lässt die Analyse
 * zeilengleich wie ohne TypeSafe laufen; `retrieval` filtert die Belegkandidaten,
 * `verification` triagiert die Verifikation und prüft die Zitate, `all` beides.
 *
 * Anders als bei `REVIEW_DECISION_ENGINE` fällt ein unbekannter Wert **still auf
 * `off`** zurück: `off` ist hier das heutige, erprobte Verhalten. Ein Tippfehler
 * darf die Gap-Analyse weder blockieren noch unbemerkt über Jev leiten. Der Wert wird
 * beim Start der Analyse eingefroren; der Lauf liest ihn danach nie wieder.
 */
export function analysisJevAssistMode(): AnalysisJevAssistMode {
  return parseAnalysisJevAssistMode(configuredValue("ANALYSIS_JEV_ASSIST").toLowerCase());
}

export type DisclosureJevAssist = "on" | "off";

/**
 * Ob Jev (TypeSafe) im Plausicheck der Offenlegungspflicht Fundstellen zuerst einordnet.
 * `on` ist der Standard (docs/DECISIONS.md D-036): die Einordnung vieler Fundstellen
 * über das Nutzermodell ist erheblich teurer. Ohne gespeicherten TypeSafe-Schlüssel
 * läuft der Lauf trotzdem, dann über das Nutzermodell allein, und wird als `off`
 * eingefroren.
 *
 * Ein unbekannter Wert fällt still auf `off` zurück: dann ordnet das Nutzermodell alles
 * ein wie ohne TypeSafe. Ein Tippfehler darf weder Läufe blockieren noch Anfragen an
 * einen Dienst schicken, den der Betreiber abschalten wollte.
 */
export function disclosureJevAssist(): DisclosureJevAssist {
  const value = configuredValue("DISCLOSURE_JEV_ASSIST").toLowerCase();
  if (!value || value === "on") return "on";
  return "off";
}
