/**
 * Grenzen der Einordnung über das Nutzermodell. Ein eigenes Modul ohne Abhängigkeiten:
 * der Workflow liest die Parallelität, und Workflow-Code darf keine Node-Module laden.
 */

/** Fundstellen je Aufruf. */
export const assignmentBatchSize = 12;
/** Parallele Aufrufe je Block. */
export const assignmentConcurrency = 8;
/** Darunter bleibt eine Zuordnung unsicher (orange), auch wenn die Zahl abweicht. */
export const assignmentConfidenceThresholdBp = 7_000;
