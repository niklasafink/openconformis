import { describe, expect, it } from "vitest";

import { createRequirementSignal } from "./signal";
import type { RetrievalBlock, RetrievalRequirement } from "./retrieval";

const requirement: RetrievalRequirement = {
  externalKey: "dora-5-2",
  regulatoryId: "Art. 5 Abs. 2 DORA",
  title: "Governance- und Kontrollrahmen",
  legalText: "Das Leitungsorgan genehmigt und überwacht den IKT-Risikomanagementrahmen.",
  assessmentAspects: ["Genehmigung durch das Leitungsorgan", "Laufende Überwachung der Umsetzung"],
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

describe("lexical requirement signal", () => {
  it("reports a strong signal when every aspect has a passage", () => {
    const signal = createRequirementSignal(requirement, [
      block(1, "Die Genehmigung durch das Leitungsorgan erfolgt jährlich im Governance-Ausschuss."),
      block(2, "Die laufende Überwachung der Umsetzung obliegt dem Kontrollrahmen des Vorstands."),
      block(3, "Der Governance- und Kontrollrahmen ist dokumentiert."),
    ]);

    expect(signal.level).toBe("strong");
    expect(signal.coveragePercent).toBe(100);
    expect(signal.openAspects).toEqual([]);
    expect(signal.hits.length).toBeGreaterThan(0);
  });

  it("reports a weak signal and no passages when the policy does not mention the topic", () => {
    const signal = createRequirementSignal(requirement, [
      block(1, "Urlaubsanträge werden im Personalportal eingereicht."),
      block(2, "Die Reisekostenabrechnung erfolgt zum Monatsende."),
    ]);

    expect(signal.level).toBe("weak");
    expect(signal.coveragePercent).toBe(0);
    expect(signal.hits).toEqual([]);
    expect(signal.openAspects).toHaveLength(3);
  });

  it("reports a partial signal when only some aspects appear", () => {
    const signal = createRequirementSignal(requirement, [
      block(1, "Die Genehmigung durch das Leitungsorgan ist im Protokoll festgehalten."),
      block(2, "Urlaubsanträge werden im Personalportal eingereicht."),
    ]);

    expect(signal.level).toBe("partial");
    expect(signal.coveredAspects).toContain("Genehmigung durch das Leitungsorgan");
    expect(signal.openAspects).toContain("Laufende Überwachung der Umsetzung");
  });

  it("keeps every excerpt an exact substring of its document block", () => {
    const long = `Einleitung ohne Bezug. ${"Füllsatz ohne Begriffe. ".repeat(12)}Die laufende Überwachung der Umsetzung wird durch das Leitungsorgan wahrgenommen und quartalsweise dokumentiert. ${"Nachlauf ohne Begriffe. ".repeat(12)}`;
    const blocks = [block(1, long)];
    const signal = createRequirementSignal(requirement, blocks);

    for (const hit of signal.hits) {
      const source = blocks.find(({ id }) => id === hit.documentBlockId);
      expect(source?.canonicalText).toContain(hit.excerpt);
    }
    expect(signal.hits[0]?.excerpt.length).toBeLessThanOrEqual(261);
  });

  it("is deterministic for identical input", () => {
    const blocks = [
      block(1, "Die Genehmigung durch das Leitungsorgan erfolgt jährlich."),
      block(2, "Die laufende Überwachung der Umsetzung ist geregelt."),
    ];

    expect(createRequirementSignal(requirement, blocks)).toEqual(
      createRequirementSignal(requirement, blocks),
    );
  });
});
