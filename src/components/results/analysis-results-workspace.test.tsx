import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisResultsWorkspace, splitEvidenceHighlight } from "./analysis-results-workspace";

const labels = {
  checked: "geprüft",
  requirement: "Anforderung",
  subrequirements: "Subanforderungen",
  organizationContext: "Unternehmenskontext",
  assessment: "Begründung der Bewertung",
  confidence: "Konfidenz",
  missingInformation: "Fehlende Informationen",
  evidence: "Belegstellen",
  noEvidence: "Keine Belegstellen",
  page: "Seite",
  paragraph: "Absatz",
  exportExcel: "Excel exportieren",
  confirmedCount: "{confirmed} von {total} bestätigt",
  confirmed: "Bestätigt",
  confirm: "Bestätigen",
  confirming: "Speichert …",
  confirmationFailed: "Fehlgeschlagen",
  aiStatus: "Ursprüngliche KI-Bewertung",
  manualOverride: "Manuelle Bewertung",
  overrideReason: "Begründung",
  changeStatus: "Status ändern",
  statusDialogTitle: "Bewertung anpassen",
  statusDialogReason: "Begründung der Änderung",
  statusDialogReasonPlaceholder: "Änderung begründen",
  cancel: "Abbrechen",
  save: "Speichern",
  saving: "Speichert …",
  overrideFailed: "Override fehlgeschlagen",
  reasonTooShort: "Begründung ist zu kurz",
  policyText: "Policy-Text",
  documentLoading: "Policy wird geladen",
  documentFailed: "Policy konnte nicht geladen werden",
  assessmentPane: "Bewertung",
  policyPane: "Policy",
  openEvidence: "Belegstelle öffnen",
  status: {
    fulfilled: "Erfüllt",
    partially_fulfilled: "Teilweise erfüllt",
    not_fulfilled: "Nicht erfüllt",
    not_applicable: "Nicht einschlägig",
    no_assessment_possible: "Keine Einschätzung möglich",
  },
} as const;

const item = {
  id: "98752346-fd91-46f0-96c3-568c729486cf",
  regulatoryId: "Art. 5 Abs. 2 DORA",
  title: "Governance- und Kontrollrahmen",
  legalText: "Das Leitungsorgan überwacht die Umsetzung.",
  subrequirements: [],
  aiStatus: "partially_fulfilled" as const,
  status: "partially_fulfilled" as const,
  override: null,
  explanation: "Die laufende Überwachung ist nicht belegt.",
  missingInformation: [],
  confidencePercent: 88,
  verificationStatus: "passed" as const,
  confirmedAt: null,
  evidence: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("analysis result confirmation UI", () => {
  it("persists an individual confirmation and updates the summary", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).endsWith("/document")
          ? Response.json({ blocks: [] })
          : Response.json({ confirmed: true, confirmedAt: "2026-08-22T12:00:00.000Z" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AnalysisResultsWorkspace
        analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
        canConfirm
        canOverride={false}
        frameworkSlug="dora"
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[item]}
        labels={labels}
      />,
    );

    expect(screen.getByText("0 von 1 bestätigt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Bestätigen" }));

    await waitFor(() => expect(screen.getByText("1 von 1 bestätigt")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Bestätigt" })).toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analyses/3d594650-3436-4d0d-969e-a3b712c02ed0/results/98752346-fd91-46f0-96c3-568c729486cf/confirmation",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ confirmed: true }) }),
    );
  });

  it("does not expose the confirmation control to a read-only user", () => {
    render(
      <AnalysisResultsWorkspace
        analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
        canConfirm={false}
        canOverride={false}
        frameworkSlug="dora"
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[item]}
        labels={labels}
      />,
    );

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("overrides the effective status and keeps the original AI status visible", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith("/document")) return Response.json({ blocks: [] });
      return Response.json({
        status: "fulfilled",
        override: {
          id: "override-1",
          status: "fulfilled",
          reason: "Die Nachweise wurden manuell geprüft.",
          createdAt: "2026-08-22T12:00:00.000Z",
        },
        confirmationInvalidated: true,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AnalysisResultsWorkspace
        analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
        canConfirm={false}
        canOverride
        frameworkSlug="dora"
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[item]}
        labels={labels}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Status ändern" }));
    fireEvent.click(screen.getByRole("radio", { name: "Erfüllt" }));
    fireEvent.change(screen.getByLabelText("Begründung der Änderung"), {
      target: { value: "Die Nachweise wurden manuell geprüft." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Status ändern" })).toHaveTextContent("Erfüllt");
    expect(screen.getByText("Teilweise erfüllt", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Die Nachweise wurden manuell geprüft.")).toBeInTheDocument();
  });

  it("links an evidence reference to the matching canonical policy block", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          blocks: [
            {
              id: "block-1",
              blockKey: "p3-a2",
              ordinal: 1,
              blockType: "paragraph",
              canonicalText: "Vorher Die Richtlinie wird regelmäßig überprüft. Nachher",
              headingPath: ["Governance"],
              pageNumber: 3,
              paragraphNumber: 2,
            },
          ],
        }),
      ),
    );

    render(
      <AnalysisResultsWorkspace
        analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
        canConfirm={false}
        canOverride={false}
        frameworkSlug="dora"
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[
          {
            ...item,
            evidence: [
              {
                id: "evidence-1",
                documentBlockId: "block-1",
                citationOrder: 1,
                support: "supports",
                exactQuote: "Die Richtlinie wird regelmäßig überprüft.",
                pageNumber: 3,
                paragraphNumber: 2,
              },
            ],
          },
        ]}
        labels={labels}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Die Richtlinie wird regelmäßig überprüft.", { selector: "mark" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Belegstelle öffnen 1" }));
    await waitFor(() => expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled());
  });
});

describe("evidence highlighting", () => {
  it("splits an exact quote without rendering HTML", () => {
    expect(splitEvidenceHighlight("Vorher Belegtext Nachher", "Belegtext")).toEqual({
      before: "Vorher ",
      match: "Belegtext",
      after: " Nachher",
    });
  });

  it("returns no highlight for an empty or missing quote", () => {
    expect(splitEvidenceHighlight("Policy", "")).toBeNull();
    expect(splitEvidenceHighlight("Policy", "anderer Text")).toBeNull();
  });
});
