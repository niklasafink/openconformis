import type { SystemOneAnswer, SystemOneQuestion } from "@/domain/ai/system-one";

import { systemOneModelId } from "@/domain/ai/system-one";

import {
  buildAssignmentPrompt,
  type AssignmentAnswer,
  type AssignmentBatch,
  type AssignmentItem,
} from "./assignment";

/**
 * Einordnung durch Jev (TypeSafe System One) im Plausicheck. Jev bekommt je Fundstelle
 * den Satz mit markierter Zahl als Zustand und beantwortet zwei getypte Fragen: welchen
 * der höchstens sechs Kandidaten die Zahl nennt (oder keinen) und welche Periode sie
 * meint. Jev gibt nur Optionsschlüssel und Wahrscheinlichkeiten zurück — nie Beträge,
 * nie Text. Die Antwort wird in dasselbe Schema übersetzt wie die des Nutzermodells
 * (`AssignmentAnswer`), damit beide Wege dieselbe Nachrechnung durchlaufen.
 *
 * Die Fragen sind englisch, der Zustand bleibt der deutsche Originalsatz
 * (docs/DECISIONS.md D-029: TypeSafe nennt Deutsch schwächer als Englisch).
 */

export const disclosureJevPromptVersion = "disclosure-jev-v1";

/**
 * Jev über OpenRouter (D-036): ein Chat-Router ohne getypte Antworten. Er bekommt
 * denselben Auftrag wie das Nutzermodell und antwortet im selben Schema; die getypte
 * Garantie von System One entfällt, die Antwort wird streng geparst.
 */
export const jevRouterModelId = "typesafe/jev-router";
export const disclosureJevRouterPromptVersion = "disclosure-jev-router-v1";

/** Die Jev-Modelle, die ein Lauf einfrieren darf. */
export function isDisclosureJevModel(modelId: string | null | undefined) {
  return modelId === systemOneModelId || modelId === jevRouterModelId;
}

export function disclosureJevPromptVersionFor(modelId: string) {
  return modelId === jevRouterModelId
    ? disclosureJevRouterPromptVersion
    : disclosureJevPromptVersion;
}

/**
 * Der Auftrag an den Jev Router: der des Nutzermodells, dazu die Antwortform als Text,
 * weil der Router `response_format` nicht zusagt.
 */
export function buildJevRouterPrompt(batch: AssignmentBatch) {
  const prompt = buildAssignmentPrompt(batch);
  return {
    ...prompt,
    system: [
      prompt.system,
      'Answer with JSON only, no prose and no code fence: {"assignments":[{"ref":"F1","candidate":"1","period":"current","confidencePercent":90,"comment":"…"}]}, one entry per figure.',
    ].join("\n"),
  };
}

/**
 * Ab hier gilt Jevs Zuordnung; darunter geht die Fundstelle an das Nutzermodell.
 * Bewusst höher als die Schwelle des Modells, weil Deutsch für Jev schwächer ist.
 */
export const jevConfidenceThresholdBp = 8_000;

const periodCriteria = {
  current: "The marked figure refers to the reporting year.",
  prior: "The marked figure refers to the prior year.",
  other:
    "The marked figure refers to another date, a plan, a change amount or only a part of the line item.",
} as const;

function marked(item: AssignmentItem) {
  return `${item.sentence.slice(0, item.start)}⟦${item.sentence.slice(item.start, item.end)}⟧${item.sentence.slice(item.end)}`;
}

/** Der Optionsschlüssel eines Kandidaten; Jev verlangt Bezeichner statt Ziffern. */
function optionKey(code: string) {
  return `c${code}`;
}

/** Zustand und Fragen für eine Fundstelle. */
export function jevRequestFor(item: AssignmentItem): {
  state: string;
  questions: Record<"line_item" | "period", SystemOneQuestion>;
} {
  const lineItem: Record<string, string> = {};
  for (const candidate of item.candidates) {
    lineItem[optionKey(candidate.code)] =
      `The marked figure states the line item "${candidate.label}".`;
  }
  lineItem.none = "The marked figure states none of the listed line items.";
  return {
    state: marked(item),
    questions: {
      line_item: {
        type: "choice",
        instructions:
          "The state is one sentence of a German audit report. One figure is marked with ⟦ and ⟧. Decide which line item of the financial statements the marked figure states.",
        criteria: lineItem,
      },
      period: {
        type: "choice",
        instructions:
          "The state is one sentence of a German audit report. One figure is marked with ⟦ and ⟧. Decide which period the marked figure refers to.",
        criteria: periodCriteria,
      },
    },
  };
}

function choiceOf(answer: SystemOneAnswer | undefined) {
  return answer?.type === "choice" ? answer : undefined;
}

/**
 * Übersetzt Jevs Antworten eines Batches in das Antwortschema des Nutzermodells. Eine
 * Fundstelle ohne verwertbare Antwort (Ausfall, falscher Fragetyp, unbekannte Option)
 * fehlt einfach und geht an das Nutzermodell. Die Konfidenz ist die kleinere der beiden
 * Fragen: eine sichere Zeile mit unsicherer Periode ist keine sichere Zuordnung.
 */
export function jevAnswerFor(
  batch: AssignmentBatch,
  answers: ReadonlyMap<string, Readonly<Record<string, SystemOneAnswer>>>,
): AssignmentAnswer {
  const assignments: AssignmentAnswer["assignments"] = [];
  for (const item of batch.items) {
    const answer = answers.get(item.ref);
    const lineItem = choiceOf(answer?.line_item);
    const period = choiceOf(answer?.period);
    if (!lineItem || !period) continue;
    const candidate =
      lineItem.choice === "none"
        ? "none"
        : item.candidates.find((option) => optionKey(option.code) === lineItem.choice)?.code;
    if (!candidate) continue;
    if (period.choice !== "current" && period.choice !== "prior" && period.choice !== "other") {
      continue;
    }
    const confidence = Math.min(lineItem.confidence, period.confidence);
    assignments.push({
      ref: item.ref,
      candidate,
      period: period.choice,
      confidencePercent: Math.round(Math.min(Math.max(confidence, 0), 1) * 100),
      comment: "",
    });
  }
  return { assignments };
}

/**
 * Die Fundstellen, die Jev sicher eingeordnet hat — auch „keiner“ ist eine Antwort.
 * Alle anderen gehen an das Nutzermodell.
 */
export function jevResolvedFigureIds(
  batch: AssignmentBatch,
  answer: AssignmentAnswer,
  thresholdBp: number = jevConfidenceThresholdBp,
): Set<string> {
  const byRef = new Map(batch.items.map((item) => [item.ref, item]));
  const resolved = new Set<string>();
  for (const entry of answer.assignments) {
    const item = byRef.get(entry.ref);
    if (item && entry.confidencePercent * 100 >= thresholdBp) resolved.add(item.figureId);
  }
  return resolved;
}
