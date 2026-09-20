import type { SystemOneAnswer, SystemOneQuestion } from "@/domain/ai/system-one";
import { citationCheckFromAnswer } from "@/domain/review/citation";
import {
  assessmentCitationOutcome,
  candidateQuestions,
  evidenceCitationQuestion,
  filterCandidates,
  probabilityBasisPoints,
  triageWaivesVerification,
  verificationTriageQuestion,
  type AssessmentCitationOutcome,
  type CandidateFilterResult,
  type CandidateJudgement,
  type EvidenceCitationCheck,
  type EvidenceSupport,
  type FilterableCandidate,
  type JevRequirementText,
} from "@/domain/analysis/jev-assist";
import { composeState, estimateTokenCount, stateBudgetFor } from "@/server/ai/system-one-budget";

/**
 * Die drei Eingriffe der Jev-Hilfe, ohne Datenbank und ohne Netz: alles, was Jev
 * kostet oder wissen muss, kommt über den Port `JevAsk` herein. Das ist der Grund
 * für die Trennung — das Verhalten bei Ausfall, Fehlantwort und Überlänge lässt sich
 * so ohne Anbieter prüfen.
 *
 * Grundsatz für jede Funktion hier: **Jev kann nichts hinzufügen.** Der Vorfilter
 * entfernt Kandidaten, die Triage lässt höchstens eine Verifikation aus, die
 * Zitatprüfung setzt höchstens einen Vermerk. Beim Ausfall von Jev (`undefined`)
 * geschieht dasselbe wie ohne Jev.
 */

export type JevStage = "jev_prefilter" | "jev_triage" | "jev_citation";

export type JevCall = {
  scopeItemId: string;
  stage: JevStage;
  state: string;
  questions: Record<string, SystemOneQuestion>;
};

/** Beantwortet eine Anfrage oder gibt `undefined` zurück; wirft nie. */
export type JevAsk = (call: JevCall) => Promise<Record<string, SystemOneAnswer> | undefined>;

type Passage = { blockKey: string; canonicalText: string };

/** Passt der Text samt längster Frage in den Zustand von Jev? Sonst wird nicht gefragt. */
function fitsState(text: string, questions: readonly SystemOneQuestion[]) {
  return estimateTokenCount(text) <= stateBudgetFor(questions);
}

/**
 * Retrieval-Vorfilter. Je Kandidat eine Anfrage mit zwei Fragen (Relevanz für die
 * Anforderung, Anweisung an einen Leser); Kontext-Abschnitte bekommen nur die zweite.
 * Kandidaten, die Jev nicht beurteilen konnte, bleiben im Paket.
 */
export async function prefilterCandidates<
  T extends FilterableCandidate & { canonicalText: string },
>(
  ask: JevAsk,
  input: { scopeItemId: string; requirement: JevRequirementText },
  candidates: readonly T[],
): Promise<CandidateFilterResult<T>> {
  const { relevance, injection } = candidateQuestions(input.requirement);
  const judgements = new Map<string, CandidateJudgement>();

  await Promise.all(
    candidates.map(async (candidate) => {
      const questions: Record<string, SystemOneQuestion> =
        candidate.role === "match" ? { relevance, injection } : { injection };
      if (!fitsState(candidate.canonicalText, Object.values(questions))) return;
      const answers = await ask({
        scopeItemId: input.scopeItemId,
        stage: "jev_prefilter",
        state: composeState(
          [{ blockKey: candidate.blockKey, canonicalText: candidate.canonicalText }],
          [candidate.blockKey],
        ),
        questions,
      });
      if (!answers) return;
      judgements.set(candidate.blockKey, {
        relevanceBp: probabilityBasisPoints(answers.relevance),
        injectionBp: probabilityBasisPoints(answers.injection),
      });
    }),
  );

  return filterCandidates(candidates, judgements);
}

/**
 * Verifikations-Triage: Jev beurteilt die zitierten Abschnitte gegen „erfüllt".
 * `true` bedeutet: das Zweitmodell darf entfallen. Alles andere — Widerspruch,
 * Schweigen, niedrige Konfidenz, Überlänge, Ausfall — lässt es laufen.
 */
export async function triageVerification(
  ask: JevAsk,
  input: { scopeItemId: string; requirement: JevRequirementText; passages: readonly Passage[] },
): Promise<boolean> {
  if (input.passages.length === 0) return false;
  const question = verificationTriageQuestion(input.requirement);
  const state = composeState(
    input.passages,
    input.passages.map(({ blockKey }) => blockKey),
  );
  if (!fitsState(state, [question])) return false;
  const answers = await ask({
    scopeItemId: input.scopeItemId,
    stage: "jev_triage",
    state,
    questions: { triage: question },
  });
  return triageWaivesVerification(answers?.triage);
}

/**
 * Zitatprüfung, Stufe zwei. Prüft je Zitat, ob es die Behauptung trägt, die seine
 * Markierung erhebt. Stufe eins — der exakte Substring-Vergleich — ist Sache von
 * `validateAndGroundAssessment` und lief bereits.
 */
export async function checkAssessmentCitations(
  ask: JevAsk,
  input: {
    scopeItemId: string;
    requirement: JevRequirementText;
    status: string;
    evidence: readonly { support: EvidenceSupport; exactQuote: string }[];
  },
): Promise<AssessmentCitationOutcome> {
  const checks = await Promise.all(
    input.evidence.map(async (entry): Promise<EvidenceCitationCheck> => {
      if (entry.support === "context") return { support: "context" };
      const question = evidenceCitationQuestion(entry.support, input.requirement);
      if (!fitsState(entry.exactQuote, [question])) return { support: entry.support };
      const answers = await ask({
        scopeItemId: input.scopeItemId,
        stage: "jev_citation",
        state: composeState([{ blockKey: "quote", canonicalText: entry.exactQuote }], ["quote"]),
        questions: { claim: question },
      });
      const answer = answers?.claim;
      return {
        support: entry.support,
        check: answer ? citationCheckFromAnswer(answer) : undefined,
      };
    }),
  );
  return assessmentCitationOutcome(input.status, checks);
}
