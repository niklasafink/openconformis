import { z } from "zod";

/**
 * Verträge für TypeSafe System One („Jev"). Das Modell beantwortet getypte Fragen
 * zu einem Zustand und gibt dabei ausschließlich Werte zurück, die im Fragetyp
 * angelegt sind: eine Wahrscheinlichkeit (`noul`), eine der vorgegebenen Optionen
 * (`choice`) oder eine Stufe der vorgegebenen Skala (`score`). Es gibt **nie** Text
 * zurück.
 *
 * Daraus folgt die tragende Entwurfsentscheidung dieses Moduls (docs/DECISIONS.md
 * D-029): eine Begründung wird aus Kriterium, Beleg und Wahrscheinlichkeit
 * zusammengesetzt und nicht erzeugt. Sie kann deshalb nichts erfinden.
 *
 * Die Datei liegt bewusst in `src/domain/`: sie kennt weder `fetch` noch Datenbank
 * noch Umgebungsvariablen.
 */

/** Die einzige Modellroute von System One. */
export const systemOneModelId = "jev-latest";

/** Grenzen des Anbieters. Der Adapter hält sie ein, die Batch-Planung rechnet damit. */
export const systemOneLimits = {
  /** Gesamter Kontext: Zustand und alle Fragen zusammen. */
  contextTokens: 64_000,
  /** Zustand plus die längste einzelne Frage. Das ist die bindende Grenze. */
  stateTokens: 32_000,
  /** Eine Auswahlfrage trägt bis 255 Optionen. */
  maximumChoiceOptions: 255,
  /** Eine Score-Frage trägt 2 bis 10 Stufen. */
  minimumScoreLevels: 2,
  maximumScoreLevels: 10,
  /** Ratelimit des Anbieters, beide Grenzen gelten gleichzeitig. */
  requestsPerMinute: 1_200,
  tokensPerSecond: 250_000,
} as const;

/**
 * Fragenschlüssel sind Bezeichner, keine freien Texte: sie wandern als Objektschlüssel
 * durch die Anfrage und wieder zurück und müssen auf beiden Seiten gleich lauten.
 */
export const systemOneQuestionKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/u, "Fragenschlüssel: Kleinbuchstaben, Ziffern und Unterstrich");

const instructionsSchema = z.string().trim().min(1).max(4_000);
const criterionSchema = z.string().trim().min(1).max(2_000);

/**
 * Ja/Nein mit Wahrscheinlichkeit. Beide Seiten werden beschrieben, damit „nein"
 * nicht bloß die Abwesenheit von „ja" ist — das trennt „Der Vertrag verbietet es"
 * von „Der Vertrag sagt dazu nichts".
 */
export const systemOneNoulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: instructionsSchema,
  criteria: z.object({ true: criterionSchema, false: criterionSchema }),
});

/** Eine von mehreren Optionen. Der Schlüssel der Option ist die Antwort. */
export const systemOneChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: instructionsSchema,
  criteria: z
    .record(systemOneQuestionKeySchema, criterionSchema)
    .refine(
      (criteria) =>
        Object.keys(criteria).length >= 2 &&
        Object.keys(criteria).length <= systemOneLimits.maximumChoiceOptions,
      `Auswahl braucht 2 bis ${systemOneLimits.maximumChoiceOptions} Optionen`,
    ),
});

/** Eine Stufe einer geordneten Skala. Die Reihenfolge der Kriterien ist die Skala. */
export const systemOneScoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: instructionsSchema,
  criteria: z
    .array(criterionSchema)
    .min(systemOneLimits.minimumScoreLevels)
    .max(systemOneLimits.maximumScoreLevels),
});

export const systemOneQuestionSchema = z.discriminatedUnion("type", [
  systemOneNoulQuestionSchema,
  systemOneChoiceQuestionSchema,
  systemOneScoreQuestionSchema,
]);

export type SystemOneQuestion = z.infer<typeof systemOneQuestionSchema>;
export type SystemOneQuestionType = SystemOneQuestion["type"];

/**
 * Anfrage an System One. `state` bleibt der deutsche Originaltext des Dokuments,
 * `instructions` und `criteria` sind englisch — TypeSafe nennt Deutsch ausdrücklich
 * schwächer als Englisch (docs/DECISIONS.md D-029).
 */
export const systemOneRequestSchema = z.object({
  model: z.string().trim().min(1),
  state: z.string().min(1),
  questions: z
    .record(systemOneQuestionKeySchema, systemOneQuestionSchema)
    .refine((questions) => Object.keys(questions).length > 0, "mindestens eine Frage"),
});

export type SystemOneRequestBody = z.infer<typeof systemOneRequestSchema>;

const probabilitySchema = z.number().min(0).max(1);

export const systemOneNoulAnswerSchema = z.object({
  type: z.literal("noul"),
  /** Wahrscheinlichkeit, dass die Aussage zutrifft. */
  noul: probabilitySchema,
});

export const systemOneChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1),
  confidence: probabilitySchema,
  probabilities: z.record(z.string(), probabilitySchema),
});

export const systemOneScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: probabilitySchema,
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.record(z.string(), probabilitySchema),
});

export const systemOneAnswerSchema = z.discriminatedUnion("type", [
  systemOneNoulAnswerSchema,
  systemOneChoiceAnswerSchema,
  systemOneScoreAnswerSchema,
]);

export type SystemOneAnswer = z.infer<typeof systemOneAnswerSchema>;

export const systemOneResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), systemOneAnswerSchema),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().nullable().optional(),
      output_tokens: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
});

export type SystemOneResponseBody = z.infer<typeof systemOneResponseSchema>;

/**
 * Konfidenz einer Antwort als eine Zahl, über alle drei Fragetypen hinweg.
 *
 * `noul` liefert keine eigene Konfidenz, sondern nur die Wahrscheinlichkeit. Eine
 * 0,5 ist dort die *unsicherste* Antwort, 0 und 1 sind die sichersten — deshalb der
 * Abstand zur Mitte, auf 0 bis 1 gespreizt. Ohne diese Umrechnung eskalierte
 * ausgerechnet ein klares „nein" (0,02) als vermeintlich unsicher.
 */
export function systemOneConfidence(answer: SystemOneAnswer): number {
  return answer.type === "noul" ? Math.abs(answer.noul - 0.5) * 2 : answer.confidence;
}

/** Konfidenz als Basispunkte, so wie Schwellwerte und Datenbank sie führen. */
export function systemOneConfidenceBasisPoints(answer: SystemOneAnswer): number {
  return Math.round(systemOneConfidence(answer) * 10_000);
}

/**
 * Der gewählte Wert als Zeichenkette für Anzeige und Protokoll. Für `noul` ist das
 * die Entscheidung bei 0,5, nicht die Wahrscheinlichkeit selbst — die steht daneben.
 */
export function systemOneDecision(answer: SystemOneAnswer): string {
  switch (answer.type) {
    case "noul":
      return answer.noul >= 0.5 ? "true" : "false";
    case "choice":
      return answer.choice;
    case "score":
      return String(answer.score);
  }
}

/**
 * Prüft, ob die Antwort zur gestellten Frage passt. Der Anbieter kann laut eigener
 * Zusage keinen ungültigen Wert liefern; geprüft wird trotzdem, weil sonst ein
 * vertauschter Fragenschlüssel unbemerkt in eine Bewertung liefe.
 */
export function answerMatchesQuestion(question: SystemOneQuestion, answer: SystemOneAnswer) {
  if (question.type !== answer.type) return false;
  if (question.type === "choice" && answer.type === "choice") {
    return Object.hasOwn(question.criteria, answer.choice);
  }
  if (question.type === "score" && answer.type === "score") {
    return answer.score >= 0 && answer.score <= question.criteria.length - 1;
  }
  return true;
}

/**
 * Kosten in Mikro-Einheiten: 0,042 $ je Million Eingabe-Token, Ausgabe ist unbepreist.
 * Ein Ort für die Rechnung, damit Vertragsprüfung und Gap-Analyse nicht auseinanderlaufen.
 */
export function systemOneCostMicrounits(inputTokens: number | undefined): number | undefined {
  if (!inputTokens) return undefined;
  return Math.round((inputTokens / 1_000_000) * 0.042 * 1_000_000);
}
