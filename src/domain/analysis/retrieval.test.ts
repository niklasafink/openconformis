import { describe, expect, it } from "vitest";

import { createRetrievalPacket, type RetrievalBlock, type RetrievalRequirement } from "./retrieval";

const requirement: RetrievalRequirement = {
  externalKey: "dora-5-2",
  regulatoryId: "Art. 5 Abs. 2 DORA",
  title: "Governance- und Kontrollrahmen",
  legalText: "Das Leitungsorgan genehmigt und überwacht den IKT-Risikomanagementrahmen.",
  assessmentAspects: ["Genehmigung durch das Leitungsorgan", "laufende Überwachung"],
  sizeGuidance: "Die Verantwortlichkeit bleibt beim Leitungsorgan.",
  subrequirements: [],
};

function block(ordinal: number, canonicalText: string): RetrievalBlock {
  return {
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    blockKey: `block-${ordinal}`,
    ordinal,
    canonicalText,
    headingPath: [],
    tokenCount: canonicalText.split(/\s+/u).length,
    textHash: String(ordinal).repeat(64).slice(0, 64),
    pageNumber: 1,
    paragraphNumber: ordinal,
  };
}

describe("deterministic lexical retrieval", () => {
  it("ranks governance evidence and includes bounded neighbour context", () => {
    const packet = createRetrievalPacket(requirement, [
      block(1, "Einleitung und Zweck der Richtlinie."),
      block(2, "Das Leitungsorgan genehmigt den IKT-Risikomanagementrahmen jährlich."),
      block(3, "Die Umsetzung wird laufend durch den Vorstand überwacht."),
      block(4, "Mitarbeitende nehmen an Schulungen teil."),
    ]);

    expect(packet.candidates[0]?.blockKey).toBe("block-2");
    expect(packet.candidates.some(({ role }) => role === "context_before")).toBe(true);
    expect(packet.tokenCount).toBeGreaterThan(0);
    expect(packet.inputHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(packet.outputHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("returns no evidence when the policy has no lexical overlap", () => {
    const packet = createRetrievalPacket(requirement, [
      block(1, "Urlaubsanträge werden im Personalportal eingereicht."),
      block(2, "Die Reisekostenabrechnung erfolgt zum Monatsende."),
    ]);

    expect(packet.candidates).toEqual([]);
    expect(packet.tokenCount).toBe(0);
  });

  it("respects the token budget deterministically", () => {
    const blocks = Array.from({ length: 8 }, (_, index) =>
      block(index + 1, "Leitungsorgan Genehmigung Überwachung IKT Risikomanagementrahmen"),
    );
    const first = createRetrievalPacket(requirement, blocks, { maximumTokens: 12 });
    const second = createRetrievalPacket(requirement, blocks, { maximumTokens: 12 });

    expect(first.tokenCount).toBeLessThanOrEqual(12);
    expect(first.outputHash).toBe(second.outputHash);
  });
});
