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
    organizationContext: "Leitungsorgan ist der Gesamtvorstand.",
    locale: "de",
    status: "completed",
    fundingMode: "sponsored",
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
        evidence: [
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
    overrideHistory: [
      {
        regulatoryId: "Art. 5 Abs. 2 DORA",
        status: "partially_fulfilled",
        reason: "Nachweise wurden manuell geprüft.",
        actorUserId: "reviewer-1",
        createdAt: new Date("2026-08-22T10:20:00.000Z"),
      },
    ],
    invocations: [
      {
        invocationStage: "assessment",
        provider: "openrouter",
        modelId: "anthropic/claude-test",
        providerRequestId: "request-1",
        status: "succeeded",
        cacheHit: true,
        inputTokens: 1_200,
        cachedInputTokens: 900,
        outputTokens: 220,
        reasoningTokens: 50,
        costMicrounits: 12_500,
        latencyMilliseconds: 1_450,
        errorCode: null,
        startedAt: new Date("2026-08-22T10:02:00.000Z"),
        completedAt: new Date("2026-08-22T10:02:02.000Z"),
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

  it("creates a localized workbook with result, evidence and audit sheets", async () => {
    const bytes = await buildAnalysisXlsx(fixture());
    expect(bytes.byteLength).toBeGreaterThan(1_000);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets.map(({ name }) => name)).toEqual([
      "Übersicht",
      "Ergebnisse",
      "Belegstellen",
      "Prüfpfad",
      "Prüfhistorie",
      "Modellaufrufe",
    ]);

    const results = workbook.getWorksheet("Ergebnisse");
    expect(results?.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(results?.autoFilter).toBeTruthy();
    expect(results?.getCell("A2").value).toBe("Art. 5 Abs. 2 DORA");
    expect(results?.getCell("C2").value).toBe('\'=HYPERLINK("https://example.invalid")');
    expect(results?.getCell("E2").value).toBe("Teilweise erfüllt");
    expect(results?.getCell("F2").value).toBe("Teilweise erfüllt");
    expect(results?.getCell("G2").value).toBe("Nachweise wurden manuell geprüft.");

    const evidence = workbook.getWorksheet("Belegstellen");
    expect(evidence?.getCell("E2").value).toBe("Die Richtlinie wird regelmäßig überprüft.");
    expect(evidence?.getCell("H2").value).toBe("block-hash");

    const reviewHistory = workbook.getWorksheet("Prüfhistorie");
    expect(reviewHistory?.getCell("A2").value).toBe("Art. 5 Abs. 2 DORA");
    expect(reviewHistory?.getCell("C2").value).toBe("Nachweise wurden manuell geprüft.");

    const serializedValues = workbook.worksheets
      .flatMap((sheet) => sheet.getSheetValues())
      .join(" ");
    expect(serializedValues).not.toContain("secret-canary");
  });

  it("creates an ASCII-safe stable download name", () => {
    expect(createAnalysisExportFilename(fixture())).toBe("gap-analyse-dora-3d594650.xlsx");
  });
});
