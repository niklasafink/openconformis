import { z } from "zod";

import type { RequirementAssessment } from "./result-contract";

/**
 * Zwei Arbeitsweisen auf derselben Gap-Analyse. Bewertung und Verifikation sind
 * in beiden Fällen identisch — dieselbe Policy ergibt dieselbe Lücke. Das Profil
 * bestimmt nur den abschließenden Text je Lücke: der Prüfer bekommt eine
 * Feststellung für den Prüfungsbericht, das Institut eine Maßnahmenliste.
 */
export const analysisProfileSchema = z.enum(["auditor", "institution"]);

export type AnalysisProfile = z.infer<typeof analysisProfileSchema>;

export const defaultAnalysisProfile: AnalysisProfile = "auditor";

/**
 * Nur Lücken bekommen einen Ergebnistext. Eine erfüllte Anforderung hat weder
 * eine Feststellung noch eine Maßnahme, und eine nicht einschlägige erst recht
 * nicht; jeder zusätzliche Aufruf kostete Zeit und Geld ohne Aussage.
 */
export const conclusionStatuses = [
  "partially_fulfilled",
  "not_fulfilled",
  "no_assessment_possible",
] as const;

export function requiresConclusion(status: RequirementAssessment["status"]): boolean {
  return (conclusionStatuses as readonly string[]).includes(status);
}

/** Welche Anweisungsart das Profil beim Start einfriert. */
export function conclusionInstructionKind(profile: AnalysisProfile) {
  return profile === "auditor" ? ("finding" as const) : ("remediation" as const);
}
