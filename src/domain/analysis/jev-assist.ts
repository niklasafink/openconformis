import { z } from "zod";

import type { SystemOneAnswer, SystemOneQuestion } from "@/domain/ai/system-one";
import {
  citationCheckFromAnswer,
  defaultCitationAcceptThresholdBp,
  type CitationCheck,
} from "@/domain/review/citation";
import { citationQuestion, injectionQuestion, relevanceQuestionFor } from "@/domain/review/column";

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

/**
 * Was Jev über eine Anforderung wissen muss. Der Text bleibt deutsch — er ist der
 * Originalwortlaut des Rahmenwerks; nur die Fragen um ihn herum sind englisch.
 */
export type JevRequirementText = {
  regulatoryId: string;
  title: string;
  legalText: string;
  assessmentAspects: readonly string[];
};

const requirementDescriptionLimit = 1_600;

export function requirementDescription(requirement: JevRequirementText): string {
  const aspects = requirement.assessmentAspects.length
    ? ` Mandatory aspects: ${requirement.assessmentAspects.join("; ")}.`
    : "";
  return `${requirement.regulatoryId} ${requirement.title}: ${requirement.legalText}${aspects}`
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, requirementDescriptionLimit);
}

/* ------------------------------------------------------------------------------------
 * 3. Retrieval-Vorfilter
 * ---------------------------------------------------------------------------------- */

/** Ein Treffer fliegt nur raus, wenn er klar unerheblich ist — nicht schon bei „unsicher". */
export const irrelevantBelowBasisPoints = 2_500;
/** Ab hier gilt ein Abschnitt als Anweisung an einen Leser und verlässt den Prompt. */
export const injectionAtBasisPoints = 5_000;

export function candidateQuestions(requirement: JevRequirementText): {
  relevance: SystemOneQuestion;
  injection: SystemOneQuestion;
} {
  return {
    relevance: relevanceQuestionFor(
      `Does the policy meet this regulatory requirement? ${requirementDescription(requirement)}`,
      "policy",
    ),
    injection: injectionQuestion(),
  };
}

export type CandidateJudgement = {
  /** Wahrscheinlichkeit „trägt zur Anforderung bei"; fehlt, wenn Jev nicht antwortete. */
  relevanceBp?: number;
  injectionBp?: number;
};

export function probabilityBasisPoints(answer: SystemOneAnswer | undefined): number | undefined {
  if (!answer || answer.type !== "noul") return undefined;
  return Math.round(Math.min(Math.max(answer.noul, 0), 1) * 10_000);
}

export type FilterableCandidate = {
  blockKey: string;
  ordinal: number;
  role: "match" | "context_before" | "context_after";
};

export type CandidateFilterResult<T> = {
  candidates: T[];
  dropped: Array<{ blockKey: string; reason: "irrelevant" | "injection" | "orphaned_context" }>;
  /** Das ungefilterte Paket wurde verwendet, weil der Filter keinen Treffer übrig ließ. */
  fallback: boolean;
};

/**
 * Filtert die Belegkandidaten einer Anforderung nach Jevs Urteil.
 *
 * Der Filter kann nur **entfernen**, nie hinzufügen oder umschreiben: ein Beleg, den er
 * verwirft, kann dem Modell nicht mehr als Zitat dienen, und eine Bewertung, die ihn
 * dennoch zitiert, scheitert an der deterministischen Verankerung. Er kann deshalb
 * weder einen erfundenen Beleg zulassen noch einen Widerspruch in ein „erfüllt"
 * verwandeln, der nicht ohnehin im Paket fehlte.
 *
 * Fail-open zum heutigen Verhalten:
 * - ein Kandidat ohne Urteil (Jev antwortete nicht) bleibt;
 * - bleibt kein Treffer übrig, gilt das **ungefilterte** Paket — nie ein leeres.
 *
 * Kontext-Abschnitte werden nicht einzeln auf Relevanz befragt; sie bleiben, solange
 * sie an einen behaltenen Treffer grenzen und keine Anweisung enthalten.
 */
export function filterCandidates<T extends FilterableCandidate>(
  candidates: readonly T[],
  judgements: ReadonlyMap<string, CandidateJudgement>,
): CandidateFilterResult<T> {
  const dropped: CandidateFilterResult<T>["dropped"] = [];
  const surviving = new Map<string, T>();

  for (const candidate of candidates) {
    const judgement = judgements.get(candidate.blockKey);
    if ((judgement?.injectionBp ?? 0) >= injectionAtBasisPoints) {
      dropped.push({ blockKey: candidate.blockKey, reason: "injection" });
      continue;
    }
    if (
      candidate.role === "match" &&
      judgement?.relevanceBp !== undefined &&
      judgement.relevanceBp < irrelevantBelowBasisPoints
    ) {
      dropped.push({ blockKey: candidate.blockKey, reason: "irrelevant" });
      continue;
    }
    surviving.set(candidate.blockKey, candidate);
  }

  const keptMatches = [...surviving.values()].filter(({ role }) => role === "match");
  if (keptMatches.length === 0) {
    return { candidates: [...candidates], dropped: [], fallback: true };
  }

  const kept: T[] = [];
  for (const candidate of candidates) {
    if (!surviving.has(candidate.blockKey)) continue;
    if (
      candidate.role !== "match" &&
      !keptMatches.some((match) => Math.abs(match.ordinal - candidate.ordinal) === 1)
    ) {
      dropped.push({ blockKey: candidate.blockKey, reason: "orphaned_context" });
      continue;
    }
    kept.push(candidate);
  }
  return { candidates: kept, dropped, fallback: false };
}

/* ------------------------------------------------------------------------------------
 * 1. Verifikations-Triage
 * ---------------------------------------------------------------------------------- */

/**
 * Trägt die Belegliste zusammen die Aussage „Anforderung erfüllt"? Die Optionen sind
 * dieselben wie bei der Zitatprüfung, damit `citationCheckFromAnswer` die Antwort mit
 * derselben Schwelle liest.
 */
export function verificationTriageQuestion(requirement: JevRequirementText): SystemOneQuestion {
  return {
    type: "choice",
    instructions: `Consider the numbered policy passages. Judge whether, taken together, they show that the policy fully meets the following regulatory requirement, covering every mandatory aspect. Requirement: ${requirementDescription(requirement)}`,
    criteria: {
      supports: "The passages together show that the policy fully meets the requirement.",
      contradicts: "The passages show that the policy does not meet the requirement.",
      silent: "The passages do not show that the requirement is fully met.",
    },
  };
}

/**
 * Darf Jevs Antwort das teure Zweitmodell ersparen? Nur ein „stützt" oberhalb der
 * Schwelle. „Widerspricht", „schweigt", niedrige Konfidenz, ein falscher Fragetyp und
 * jede fehlende Antwort lassen das Zweitmodell laufen — die Triage kann eine
 * Verifikation nur auslassen, nie eine hinzufügen oder ein Ergebnis ändern.
 */
export function triageWaivesVerification(
  answer: SystemOneAnswer | undefined,
  acceptThresholdBp: number = defaultCitationAcceptThresholdBp,
): boolean {
  if (!answer) return false;
  const check = citationCheckFromAnswer(answer, acceptThresholdBp);
  return check.verdict === "verified" && !check.needsReview;
}

/* ------------------------------------------------------------------------------------
 * 2. Zitatprüfung, Stufe zwei
 * ---------------------------------------------------------------------------------- */

export type EvidenceSupport = "supports" | "contradicts" | "context";

/** Die Behauptung, die ein Zitat mit seiner Markierung erhebt. `context` behauptet nichts. */
export function evidenceClaim(
  support: Exclude<EvidenceSupport, "context">,
  requirement: JevRequirementText,
): string {
  return support === "supports"
    ? `The policy meets, at least in part, this regulatory requirement. ${requirementDescription(requirement)}`
    : `The policy does not meet, at least in part, this regulatory requirement. ${requirementDescription(requirement)}`;
}

export function evidenceCitationQuestion(
  support: Exclude<EvidenceSupport, "context">,
  requirement: JevRequirementText,
): SystemOneQuestion {
  return citationQuestion(evidenceClaim(support, requirement));
}

export type EvidenceCitationCheck = {
  support: EvidenceSupport;
  /** Fehlt, wenn Jev für dieses Zitat nicht antwortete. */
  check?: CitationCheck;
};

export type AssessmentCitationOutcome = {
  needsReview: boolean;
  reason?: "contradicted" | "not_supported";
};

/**
 * Was die Zitatprüfung für das Ergebnis heißt. Das Ergebnis wird dabei **nie
 * verändert** — es bekommt höchstens den Vermerk „Prüfbedarf", sodass es nicht still
 * als bestätigt gilt.
 *
 * - Ein Zitat, das Jev der eigenen Markierung widerspricht („stützt" markiert, aber
 *   Jev sieht das Gegenteil), macht das Ergebnis prüfbedürftig.
 * - Sonst muss mindestens ein Zitat in Richtung des Status die Schwelle erreichen:
 *   „erfüllt" braucht ein tragendes „stützt", „nicht erfüllt" ein tragendes
 *   „widerspricht", „teilweise" eines von beiden.
 * - Ohne jede Jev-Antwort (Ausfall, Fehlschlag) bleibt alles wie heute: kein Vermerk.
 */
export function assessmentCitationOutcome(
  status: string,
  checks: readonly EvidenceCitationCheck[],
): AssessmentCitationOutcome {
  const directions: readonly EvidenceSupport[] =
    status === "fulfilled"
      ? ["supports"]
      : status === "not_fulfilled"
        ? ["contradicts"]
        : status === "partially_fulfilled"
          ? ["supports", "contradicts"]
          : [];
  if (directions.length === 0) return { needsReview: false };

  const evaluated = checks.filter(
    (entry): entry is EvidenceCitationCheck & { check: CitationCheck } =>
      entry.support !== "context" && entry.check !== undefined,
  );
  if (evaluated.length === 0) return { needsReview: false };

  if (evaluated.some(({ check }) => check.verdict === "contradicted")) {
    return { needsReview: true, reason: "contradicted" };
  }
  const carried = evaluated.some(
    ({ support, check }) =>
      directions.includes(support) && check.verdict === "verified" && !check.needsReview,
  );
  return carried ? { needsReview: false } : { needsReview: true, reason: "not_supported" };
}
