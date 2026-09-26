// @vitest-environment node

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildAnalysisXlsx,
  createAnalysisExportFilename,
  safeExcelText,
  type AnalysisExportData,
} from "./analysis-xlsx";

const completedAt = new Date("2026-08-22T10:30:00.000Z");

function fixture(): AnalysisExportData {
  return {
    id: "3d594650-3436-4d0d-969e-a3b712c02ed0",
    organizationId: "organization-1",
    frameworkSlug: "dora",
    frameworkReleaseKey: "dora-2026-01",
    frameworkContentHash: "framework-hash",
    institutionSize: "medium",
    analysisProfile: "auditor",
    organizationContext: "Leitungsorgan ist der Gesamtvorstand.",
    locale: "de",
    status: "completed",
    routeProvider: "openrouter",
    providerModelId: "anthropic/claude-test",
    modelProfileId: "strict-analysis",
    verifierProviderModelId: "google/gemini-test",
    verifierModelProfileId: "strict-verifier",
    modelCatalogueVersion: "catalogue-1",
    privacyProfileId: "eu-zdr-v1",
    promptVersion: "assessment-v1",
    verifierPromptVersion: "verification-v1",
    configurationHash: "configuration-hash",
    policySha256: "policy-hash",
    policyParserVersion: "parser-v1",
    requirementCount: 1,
    createdAt: new Date("2026-08-22T10:00:00.000Z"),
    startedAt: new Date("2026-08-22T10:01:00.000Z"),
    completedAt,
    policy: { displayName: "IKT-Sicherheitsrichtlinie.docx", versionNumber: 1, pageCount: 14 },
    items: [
      {
        id: "result-1",
        regulatoryId: "Art. 5 Abs. 2 DORA",
        title: "Governance- und Kontrollrahmen",
        legalText: '=HYPERLINK("https://example.invalid")',
        assessmentAspects: ["Genehmigung", "Überwachung"],
        sourceLocator: "Art. 5 Abs. 2",
        sizeGuidance: "Proportional zur Institutsgröße.",
        contentHash: "requirement-hash",
        subrequirements: [
          {
            externalKey: "rts-2",
            regulatoryId: "RTS (EU) 2024/1774 Art. 2",
            title: "Elemente",
            legalText: "Rollen und Überprüfungszyklus dokumentieren.",
          },
        ],
        aiStatus: "partially_fulfilled",
        status: "partially_fulfilled",
        override: {
          status: "partially_fulfilled",
          reason: "Nachweise wurden manuell geprüft.",
          actorUserId: "reviewer-1",
          createdAt: new Date("2026-08-22T10:20:00.000Z"),
        },
        explanation: "Die Genehmigung ist nicht vollständig nachweisbar.",
        missingInformation: ["Genehmigungsdatum"],
        confidencePercent: 87,
        verificationStatus: "passed",
        verifierExplanation: "Die Beleglage stützt den Status.",
        confirmedByUserId: null,
        confirmedAt: null,
        conclusion: {
          profile: "auditor",
          summary:
            "Die Genehmigung des IKT-Risikomanagementrahmens durch das Leitungsorgan ist für den Prüfungszeitraum nicht dokumentiert.",
          items: ["Nachweis der Genehmigung fehlt"],
          resolvedItems: [],
        },
        evidence: [
          {
            citationOrder: 2,
            support: "context",
            exactQuote: "Der Vorstand\ngenehmigt den Rahmen.",
            blockTextHash: "block-hash-2",
            pageNumber: 7,
            paragraphNumber: 1,
          },
          {
            citationOrder: 1,
            support: "supports",
            exactQuote: "Die Richtlinie wird regelmäßig überprüft.",
            blockTextHash: "block-hash",
            pageNumber: 3,
            paragraphNumber: 2,
          },
        ],
      },
    ],
  };
}

describe("analysis Excel export", () => {
  it("neutralizes formula-like content and bounds cell length", () => {
    expect(safeExcelText("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(safeExcelText("  @malicious")).toBe("'  @malicious");
    expect(String(safeExcelText("a".repeat(40_000))).length).toBeLessThanOrEqual(32_767);
    expect(safeExcelText(7)).toBe(7);
  });

  it("exports only the results sheet with the reviewed status and policy passages", async () => {
    const bytes = await buildAnalysisXlsx(fixture());
    expect(bytes.byteLength).toBeGreaterThan(1_000);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets.map(({ name }) => name)).toEqual(["Ergebnisse"]);

    const results = workbook.getWorksheet("Ergebnisse");
    expect(results?.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(results?.autoFilter).toBeTruthy();
    const headers = (results?.getRow(1).values as unknown[]).slice(1);
    expect(headers).toContain("Finaler Status");
    expect(headers).not.toContain("Wirksamer Status");
    for (const removed of [
      "Menschlich bestätigt",
      "Bestätigt am",
      "Bestätigt von",
      "Größenleitlinie",
      "Prüfaspekte",
      "Quelle",
    ]) {
      expect(headers).not.toContain(removed);
    }
    expect(results?.getCell("A2").value).toBe("Art. 5 Abs. 2 DORA");
    expect(results?.getCell("C2").value).toBe('\'=HYPERLINK("https://example.invalid")');
    expect(results?.getCell("E2").value).toBe("Teilweise erfüllt");
    expect(results?.getCell("F1").value).toBe("Finaler Status");
    expect(results?.getCell("F2").value).toBe("Teilweise erfüllt");
    expect(results?.getCell("G2").value).toBe("Nachweise wurden manuell geprüft.");
    expect(results?.getCell("K1").value).toBe("Belegstellen in der Policy");
    expect(results?.getCell("K2").value).toBe(
      '\'- "Die Richtlinie wird regelmäßig überprüft." (S. 3)\n- "Der Vorstand genehmigt den Rahmen." (S. 7)',
    );
    expect(results?.getCell("M1").value).toBe("Feststellung");
    expect(results?.getCell("M2").value).toBe(
      "Die Genehmigung des IKT-Risikomanagementrahmens durch das Leitungsorgan ist für den Prüfungszeitraum nicht dokumentiert.",
    );
    expect(results?.getCell("N1").value).toBe("Auswirkung");
  });

  it("marks a result without evidence explicitly in the passages column", async () => {
    const data = fixture();
    data.items[0]!.evidence = [];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await buildAnalysisXlsx(data)) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    expect(workbook.getWorksheet("Ergebnisse")?.getCell("K2").value).toBe("–");
  });

  it("creates an ASCII-safe stable download name", () => {
    expect(createAnalysisExportFilename(fixture())).toBe("gap-analyse-dora-3d594650.xlsx");
  });
});
