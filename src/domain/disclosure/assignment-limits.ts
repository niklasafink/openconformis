/**
 * Grenzen der Einordnung über das Nutzermodell. Ein eigenes Modul ohne Abhängigkeiten:
 * der Workflow liest die Parallelität, und Workflow-Code darf keine Node-Module laden.
 */

/** Fundstellen je Aufruf. Klein, damit die ersten Antworten nach Sekunden vorliegen. */
export const assignmentBatchSize = 6;
/** Höchstzahl der Einträge einer gespeicherten Antwort; frühere Läufe hatten 12 je Batch. */
export const assignmentAnswerLimit = 12;
/**
 * Parallele Aufrufe je Block. Ein Abschnitt des Berichts sind so viele Batches; die
 * Abschnitte laufen von oben nach unten nacheinander.
 */
export const assignmentConcurrency = 8;
/** Darunter bleibt eine Zuordnung unsicher (orange), auch wenn die Zahl abweicht. */
export const assignmentConfidenceThresholdBp = 7_000;
