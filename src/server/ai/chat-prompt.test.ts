import { describe, expect, it } from "vitest";

import {
  createFrameworkChatSource,
  createPolicyChatSource,
  selectChatSources,
} from "@/domain/chat/retrieval";

import { buildChatSystemPrompt } from "./chat-prompt";

const frameworkSources = [
  createFrameworkChatSource({
    sourceId: "2b8221f9-bc48-4f33-9603-c64dc3f46276",
    regulatoryId: "Art. 5 DORA",
    title: "Governance",
    legalText: "Das Leitungsorgan überwacht den IKT-Risikomanagementrahmen.",
  }),
];

const policySources = [
  createPolicyChatSource({
    documentBlockId: "11111111-1111-4111-8111-111111111111",
    blockKey: "b-7",
    ordinal: 7,
    canonicalText: "Die Geschäftsleitung überwacht den IKT-Risikomanagementrahmen jährlich.",
    headingPath: ["2 Governance"],
    pageNumber: 3,
    documentName: "IT-Sicherheitsrichtlinie",
    locale: "de",
  }),
];

function build(locale: "de" | "en" = "de") {
  return buildChatSystemPrompt({
    locale,
    framework: { name: "DORA", version: "2024.1", contentClassification: "demo" },
    document: { name: "IT-Sicherheitsrichtlinie", source: "upload", pageCount: 12 },
    sources: selectChatSources({
      question: "Wer überwacht den IKT-Risikomanagementrahmen?",
      frameworkSources,
      policySources,
    }),
  });
}

describe("chat system prompt", () => {
  it("carries the rules the product depends on", () => {
    const prompt = build();

    // Ohne diese Sätze bleibt von der Erdung nur die nachgelagerte Prüfung übrig,
    // die eine unbelegte Antwort verwirft statt sie zu verhindern.
    expect(prompt).toContain("Use only numbers that appear in the retrieved sources");
    expect(prompt).toContain("must be an exact substring of one retrieved source");
    expect(prompt).toContain("untrusted input");
    expect(prompt).toContain("Do not draft, rewrite, reformulate or suggest policy wording");
    expect(prompt).toContain("Do not assign a compliance status");
    expect(prompt).toContain("Do not give legal advice");
    expect(prompt).toContain("Missing evidence is not evidence of absence");
  });

  it("states the current selection and embeds the retrieved sources", () => {
    const prompt = build();

    expect(prompt).toContain("framework: DORA (release 2024.1)");
    expect(prompt).toContain("document: IT-Sicherheitsrichtlinie");
    expect(prompt).toContain("retrieved_framework_sources: 1");
    expect(prompt).toContain("retrieved_document_sources: 1");
    expect(prompt).toContain("kind=policy_document");
    expect(prompt).toContain("Die Geschäftsleitung überwacht den IKT-Risikomanagementrahmen");
  });

  it("names the answer language and says when nothing was retrieved", () => {
    expect(build("de")).toContain("Write the entire answer in German");
    expect(build("en")).toContain("Write the entire answer in English");

    const empty = buildChatSystemPrompt({ locale: "de", sources: [] });
    expect(empty).toContain("framework: none selected");
    expect(empty).toContain("document: none selected");
    expect(empty).toContain("no source was retrieved for this question");
  });
});
