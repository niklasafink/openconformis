import { describe, expect, it } from "vitest";

import type { SystemOneAnswer } from "@/domain/ai/system-one";

import {
  assessmentCitationOutcome,
  candidateQuestions,
  filterCandidates,
  jevAssistIncludes,
  parseAnalysisJevAssistMode,
  requirementDescription,
  triageWaivesVerification,
  verificationTriageQuestion,
  type CandidateJudgement,
} from "./jev-assist";
import { isTriageEligible, reasonsAfterTriage } from "./verification-policy";

const requirement = {
  regulatoryId: "Art. 5",
  title: "Überprüfung",
  legalText: "Die Richtlinie ist jährlich zu überprüfen.",
  assessmentAspects: ["Jährlich", "Freigabe"],
};

function candidate(blockKey: string, ordinal: number, role: "match" | "context_after" = "match") {
  return { blockKey, ordinal, role };
}

const judgements = (entries: Record<string, CandidateJudgement>) =>
  new Map(Object.entries(entries));

function choice(value: string, confidence: number): SystemOneAnswer {
  return { type: "choice", choice: value, confidence, probabilities: {} };
}

describe("Jev assist modes", () => {
  it("reads only the four known values and treats anything else as off", () => {
    expect(parseAnalysisJevAssistMode("all")).toBe("all");
    expect(parseAnalysisJevAssistMode("everything")).toBe("off");
    expect(parseAnalysisJevAssistMode(undefined)).toBe("off");
  });

  it("maps each mode to the interventions it enables", () => {
    expect(jevAssistIncludes("off", "retrieval")).toBe(false);
    expect(jevAssistIncludes("off", "verification")).toBe(false);
    expect(jevAssistIncludes("retrieval", "retrieval")).toBe(true);
    expect(jevAssistIncludes("retrieval", "verification")).toBe(false);
    expect(jevAssistIncludes("verification", "verification")).toBe(true);
    expect(jevAssistIncludes("all", "retrieval")).toBe(true);
    expect(jevAssistIncludes("all", "verification")).toBe(true);
  });
});

describe("question construction", () => {
  it("bounds the requirement text so every question stays inside the provider's limit", () => {
    const long = { ...requirement, legalText: "Text ".repeat(2_000) };
    expect(requirementDescription(long).length).toBeLessThanOrEqual(1_600);
    const { relevance, injection } = candidateQuestions(long);
    expect(relevance.instructions.length).toBeLessThan(4_000);
    expect(injection.type).toBe("noul");
    expect(verificationTriageQuestion(long).instructions.length).toBeLessThan(4_000);
  });

  it("uses the citation options for triage so one threshold reads both answers", () => {
    const question = verificationTriageQuestion(requirement);
    expect(question.type).toBe("choice");
    expect(Object.keys(question.criteria)).toEqual(["supports", "contradicts", "silent"]);
  });
});

describe("retrieval prefilter", () => {
  const packet = [
    candidate("match-good", 10),
    candidate("match-bad", 20),
    candidate("match-injected", 30),
    candidate("context-of-good", 11, "context_after"),
    candidate("context-of-bad", 21, "context_after"),
  ];

  it("keeps carrying blocks, drops irrelevant and injected ones and orphaned context", () => {
    const result = filterCandidates(
      packet,
      judgements({
        "match-good": { relevanceBp: 9_000, injectionBp: 100 },
        "match-bad": { relevanceBp: 500, injectionBp: 100 },
        "match-injected": { relevanceBp: 9_000, injectionBp: 9_700 },
      }),
    );
    expect(result.fallback).toBe(false);
    expect(result.candidates.map(({ blockKey }) => blockKey)).toEqual([
      "match-good",
      "context-of-good",
    ]);
    expect(result.dropped).toEqual(
      expect.arrayContaining([
        { blockKey: "match-bad", reason: "irrelevant" },
        { blockKey: "match-injected", reason: "injection" },
        { blockKey: "context-of-bad", reason: "orphaned_context" },
      ]),
    );
  });

  it("drops a block only when it is clearly irrelevant, not merely uncertain", () => {
    const result = filterCandidates(
      [candidate("unsure", 1)],
      judgements({ unsure: { relevanceBp: 2_600 } }),
    );
    expect(result.candidates.map(({ blockKey }) => blockKey)).toEqual(["unsure"]);
  });

  it("keeps a block Jev did not judge, so a failure never removes evidence", () => {
    const result = filterCandidates(packet, judgements({}));
    expect(result.candidates).toHaveLength(packet.length);
    expect(result.dropped).toEqual([]);
  });

  it("never returns an empty packet: without a surviving match it falls back to everything", () => {
    const result = filterCandidates(
      packet,
      judgements({
        "match-good": { relevanceBp: 0 },
        "match-bad": { relevanceBp: 0 },
        "match-injected": { injectionBp: 10_000 },
      }),
    );
    expect(result.fallback).toBe(true);
    expect(result.candidates).toEqual(packet);
  });

  it("returns an empty packet only for an empty input", () => {
    expect(filterCandidates([], judgements({})).candidates).toEqual([]);
  });
});

describe("verification triage", () => {
  it("waives the second model only for a supporting answer at or above the threshold", () => {
    expect(triageWaivesVerification(choice("supports", 0.8))).toBe(true);
    expect(triageWaivesVerification(choice("supports", 0.79))).toBe(false);
    expect(triageWaivesVerification(choice("contradicts", 1))).toBe(false);
    expect(triageWaivesVerification(choice("silent", 1))).toBe(false);
    expect(triageWaivesVerification({ type: "noul", noul: 1 })).toBe(false);
    expect(triageWaivesVerification(undefined)).toBe(false);
  });

  it("only removes fulfilled when it is the sole reason", () => {
    expect(isTriageEligible(["fulfilled"])).toBe(true);
    expect(isTriageEligible(["fulfilled", "drift_sample"])).toBe(false);
    expect(isTriageEligible(["fulfilled", "low_confidence"])).toBe(false);
    expect(isTriageEligible(["contradiction"])).toBe(false);
    expect(isTriageEligible([])).toBe(false);
    expect(reasonsAfterTriage(["fulfilled"], true)).toEqual([]);
    expect(reasonsAfterTriage(["fulfilled"], false)).toEqual(["fulfilled"]);
    // Eine bestandene Triage nimmt nie die Driftstichprobe oder einen Widerspruch heraus.
    expect(reasonsAfterTriage(["fulfilled", "drift_sample"], true)).toEqual([
      "fulfilled",
      "drift_sample",
    ]);
    expect(reasonsAfterTriage(["low_confidence", "contradiction"], true)).toEqual([
      "low_confidence",
      "contradiction",
    ]);
  });
});

describe("citation check outcome", () => {
  const verified = { verdict: "verified" as const, confidenceBp: 9_000, needsReview: false };
  const weak = { verdict: "verified" as const, confidenceBp: 7_000, needsReview: true };
  const contradicted = { verdict: "contradicted" as const, confidenceBp: 9_500, needsReview: true };
  const unsupported = { verdict: "unsupported" as const, confidenceBp: 9_000, needsReview: true };

  it("accepts a fulfilled result with one carrying supporting quote", () => {
    expect(
      assessmentCitationOutcome("fulfilled", [
        { support: "supports", check: verified },
        { support: "supports", check: unsupported },
        { support: "context" },
      ]),
    ).toEqual({ needsReview: false });
  });

  it("asks for review below the threshold, on contradiction and when nothing carries", () => {
    expect(assessmentCitationOutcome("fulfilled", [{ support: "supports", check: weak }])).toEqual({
      needsReview: true,
      reason: "not_supported",
    });
    expect(
      assessmentCitationOutcome("fulfilled", [
        { support: "supports", check: verified },
        { support: "supports", check: contradicted },
      ]),
    ).toEqual({ needsReview: true, reason: "contradicted" });
    expect(
      assessmentCitationOutcome("fulfilled", [{ support: "supports", check: unsupported }]),
    ).toEqual({ needsReview: true, reason: "not_supported" });
  });

  it("checks the direction of the status: not fulfilled needs a carrying contradicts quote", () => {
    expect(
      assessmentCitationOutcome("not_fulfilled", [{ support: "contradicts", check: verified }]),
    ).toEqual({ needsReview: false });
    expect(
      assessmentCitationOutcome("not_fulfilled", [
        { support: "contradicts", check: unsupported },
        { support: "supports", check: verified },
      ]),
    ).toEqual({ needsReview: true, reason: "not_supported" });
  });

  it("changes nothing without a single Jev answer, or for results with nothing to check", () => {
    expect(assessmentCitationOutcome("fulfilled", [{ support: "supports" }])).toEqual({
      needsReview: false,
    });
    expect(assessmentCitationOutcome("fulfilled", [])).toEqual({ needsReview: false });
    expect(
      assessmentCitationOutcome("no_assessment_possible", [
        { support: "supports", check: contradicted },
      ]),
    ).toEqual({ needsReview: false });
  });
});
