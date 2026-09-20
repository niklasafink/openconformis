import { z } from "zod";

/**
 * Jev als optionale Hilfe der Gap-Analyse (docs/DECISIONS.md D-032).
 *
 * `off` ist der Standard und das heutige, erprobte Verhalten: die Analyse stellt dann
 * keine einzige Jev-Anfrage. Die Stufen bauen aufeinander nicht auf, sondern
 * unterscheiden, welcher Eingriff aktiv ist:
 *
 * - `retrieval`: die Belegkandidaten werden vor dem Prompt gefiltert.
 * - `verification`: Triage vor dem Zweitmodell und Zitatprüfung nach der Verankerung.
 * - `all`: beides.
 */
export const analysisJevAssistModeSchema = z.enum(["off", "retrieval", "verification", "all"]);

export type AnalysisJevAssistMode = z.infer<typeof analysisJevAssistModeSchema>;

export type JevAssistIntervention = "retrieval" | "verification";

/** Ein gespeicherter, unbekannter Wert gilt als `off` — nie als aktive Hilfe. */
export function parseAnalysisJevAssistMode(value: unknown): AnalysisJevAssistMode {
  const parsed = analysisJevAssistModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "off";
}

export function jevAssistIncludes(
  mode: AnalysisJevAssistMode,
  intervention: JevAssistIntervention,
): boolean {
  return mode === "all" || mode === intervention;
}
