import { describe, expect, it } from "vitest";

import { validateChatCitations } from "./citations";
import {
  createFrameworkChatSource,
  createPolicyChatSource,
  rankChatSources,
  renderRetrievalContext,
  selectChatSources,
} from "./retrieval";

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

const policyBlocks = [
  {
    text: "Dieses Handbuch regelt den Umgang mit Informationen.",
    heading: ["1 Einleitung"],
  },
  {
    text: "Die Geschäftsleitung überwacht den IKT-Risikomanagementrahmen jährlich.",
    heading: ["2 Governance"],
  },
  {
    text: "Die Überwachung wird im Protokoll des Vorstands festgehalten.",
    heading: ["2 Governance"],
  },
  {
    text: "Reisekosten werden über das Formular R-12 abgerechnet.",
    heading: ["9 Verwaltung"],
  },
].map((block, index) =>
  createPolicyChatSource({
    documentBlockId: `block-${index}`,
    blockKey: `b-${index}`,
    ordinal: index,
    canonicalText: block.text,
    headingPath: block.heading,
    pageNumber: index + 1,
    documentName: "IT-Sicherheitsrichtlinie",
    locale: "de",
  }),
);

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

  it("numbers framework and document sources in one continuous sequence", () => {
    const selected = selectChatSources({
      question: "Wer überwacht den IKT-Risikomanagementrahmen?",
      frameworkSources: sources,
      policySources: policyBlocks,
    });

    expect(selected.map((source) => source.citationOrder)).toEqual(
      selected.map((_, index) => index + 1),
    );
    const kinds = selected.map((source) => source.sourceType);
    expect(kinds.indexOf("policy_block")).toBeGreaterThan(
      kinds.lastIndexOf("framework_requirement"),
    );
    expect(selected.some((source) => source.documentBlockId === "block-1")).toBe(true);
  });

  it("keeps a document match readable by taking its neighbouring blocks along", () => {
    const selected = selectChatSources({
      question: "Wer überwacht den IKT-Risikomanagementrahmen?",
      policySources: policyBlocks,
    });
    const byBlock = new Map(selected.map((source) => [source.documentBlockId, source]));

    expect(byBlock.get("block-1")?.role).toBe("match");
    expect(byBlock.get("block-0")?.role).toBe("context");
    expect(byBlock.get("block-2")?.role).toBe("context");
    // Ein Treffer ohne Bezug zur Frage bleibt draußen, auch als Nachbar.
    expect(byBlock.has("block-3")).toBe(false);
  });

  it("keeps a document block citable with its block key and page", () => {
    const selected = selectChatSources({
      question: "Wer überwacht den IKT-Risikomanagementrahmen?",
      policySources: policyBlocks,
    });
    const validated = validateChatCitations(
      "Die Geschäftsleitung überwacht jährlich [2].",
      selected,
    );

    expect(validated.valid).toBe(true);
    expect(validated.citations[0]?.sourceType).toBe("policy_block");
    expect(validated.citations[0]?.documentBlockId).toBe("block-1");
    expect(validated.citations[0]?.locator).toContain("b-1");
    expect(validated.citations[0]?.requirementId).toBeUndefined();
  });

  it("labels every rendered source with its kind so the model cannot confuse them", () => {
    const rendered = renderRetrievalContext(
      selectChatSources({
        question: "Wer überwacht den IKT-Risikomanagementrahmen?",
        frameworkSources: sources,
        policySources: policyBlocks,
      }),
    );

    expect(rendered).toContain("kind=framework");
    expect(rendered).toContain("kind=policy_document");
    expect(rendered).toContain("role=context");
  });
});
