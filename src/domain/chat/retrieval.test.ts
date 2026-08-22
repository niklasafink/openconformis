import { describe, expect, it } from "vitest";

import { validateChatCitations } from "./citations";
import { createFrameworkChatSource, rankChatSources } from "./retrieval";

const sources = [
  createFrameworkChatSource({
    sourceId: "2b8221f9-bc48-4f33-9603-c64dc3f46276",
    regulatoryId: "Art. 5 DORA",
    title: "Governance",
    legalText: "Das Leitungsorgan überwacht den IKT-Risikomanagementrahmen.",
  }),
  createFrameworkChatSource({
    sourceId: "62156ba9-23be-448a-93a9-785d399504f1",
    regulatoryId: "Art. 8 DORA",
    title: "IKT-Assets",
    legalText: "Informationsassets und IKT-Assets werden identifiziert und klassifiziert.",
  }),
];

describe("chat retrieval and citations", () => {
  it("ranks matching regulatory requirements deterministically", () => {
    const ranked = rankChatSources("Wer muss den IKT-Risikomanagementrahmen überwachen?", sources);
    expect(ranked[0]?.label).toContain("Art. 5");
    expect(ranked[0]?.citationOrder).toBe(1);
  });

  it("accepts only citations that exist in the retrieval packet", () => {
    const ranked = rankChatSources("IKT-Assets klassifizieren", sources);
    expect(validateChatCitations("Die Assets sind zu klassifizieren [1].", ranked).valid).toBe(
      true,
    );
    expect(validateChatCitations("Nicht belegt [9].", ranked).valid).toBe(false);
    expect(validateChatCitations("Antwort ohne Quellen.", []).valid).toBe(false);
  });
});
