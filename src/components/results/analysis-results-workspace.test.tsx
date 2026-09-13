import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisResultsWorkspace, explanationPoints } from "./analysis-results-workspace";
import { splitEvidenceHighlight } from "./policy-document-viewer";
import { RequirementSelectionProvider } from "./requirement-selection";

const labels = {
  checked: "geprüft",
  requirement: "Anforderung",
  subrequirements: "Subanforderungen",
  organizationContext: "Unternehmenskontext",
  assessment: "Begründung der Bewertung",
  confidence: "Konfidenz",
  todos: "To-dos",
  todosProgress: "{done} von {total} erledigt",
  todoFailed: "To-do nicht gespeichert",
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
  originalView: "Original",
  textView: "Text",
  originalUnavailable: "Original nicht mehr verfügbar",
  pending: {
    title: "Noch nicht bewertet",
    note: "Diese Anforderung wartet auf die Bewertung durch das Modell.",
    noEvidence: "Belegstellen entstehen mit der Bewertung.",
    assessedCount: "{assessed} von {total} bewertet",
  },
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
  resolvedTodoIndexes: [],
  confidencePercent: 88,
  verificationStatus: "passed" as const,
  confirmedAt: null,
  evidence: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("assessment rationale points", () => {
  it("keeps one point per line and drops the bullet markers", () => {
    expect(
      explanationPoints("- Das Leitungsorgan genehmigt den Rahmen.\n\n• Die Überwachung fehlt."),
    ).toEqual(["Das Leitungsorgan genehmigt den Rahmen.", "Die Überwachung fehlt."]);
  });

  it("splits older prose at sentence ends but not after abbreviations or numbers", () => {
    expect(
      explanationPoints(
        "Art. 5 Abs. 2 DORA verlangt z. B. eine Genehmigung. Die Policy nennt am 14. Dezember keine Überwachung. Belege fehlen.",
      ),
    ).toEqual([
      "Art. 5 Abs. 2 DORA verlangt z. B. eine Genehmigung.",
      "Die Policy nennt am 14. Dezember keine Überwachung.",
      "Belege fehlen.",
    ]);
  });
});

describe("requirement selection for a new analysis", () => {
  it("lets single requirements be deselected and everything be selected again", () => {
    const second = {
      ...item,
      id: "4b0c6d2a-8f1e-4a7b-9c3d-5e6f7a8b9c0d",
      regulatoryId: "Art. 6 Abs. 1 DORA",
    };
    render(
      <RequirementSelectionProvider
        requirementKeys={["dora-art-5-2", "dora-art-6-1"]}
        labels={{ selectAll: "Alle Anforderungen auswählen", select: "{requirement} auswählen" }}
      >
        <AnalysisResultsWorkspace
          analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
          canConfirm={false}
          canOverride={false}
          policyName="IKT-Sicherheitsrichtlinie.docx"
          organizationContext=""
          items={[
            { ...item, requirementKey: "dora-art-5-2" },
            { ...second, requirementKey: "dora-art-6-1" },
          ]}
          labels={labels}
          documentBlocks={[]}
        />
      </RequirementSelectionProvider>,
    );

    const all = screen.getByRole("checkbox", { name: "Alle Anforderungen auswählen" });
    const first = screen.getByRole("checkbox", { name: "Art. 5 Abs. 2 DORA auswählen" });
    expect(all).toBeChecked();
    expect(first).toBeChecked();

    fireEvent.click(first);
    expect(first).not.toBeChecked();
    expect(all).toHaveAttribute("data-state", "indeterminate");

    fireEvent.click(all);
    expect(first).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Art. 6 Abs. 1 DORA auswählen" })).toBeChecked();
  });
});

describe("analysis result to-dos", () => {
  const withTodos = {
    ...item,
    missingInformation: ["Genehmigung durch das Leitungsorgan", "Überwachung der Umsetzung"],
    resolvedTodoIndexes: [1],
  };

  it("persists a checked to-do and updates the done count", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ resolvedTodoIndexes: [0, 1] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AnalysisResultsWorkspace
        analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
        canConfirm={false}
        canOverride
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[withTodos]}
        labels={labels}
        documentBlocks={[]}
      />,
    );

    expect(screen.getByText("1 von 2 erledigt")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Überwachung der Umsetzung" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Genehmigung durch das Leitungsorgan" }));

    await waitFor(() => expect(screen.getByText("2 von 2 erledigt")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analyses/3d594650-3436-4d0d-969e-a3b712c02ed0/results/98752346-fd91-46f0-96c3-568c729486cf/todos",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ index: 0, done: true }) }),
    );
  });

  it("shows the to-do state read-only without review permission", () => {
    render(
      <AnalysisResultsWorkspace
        analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
        canConfirm={false}
        canOverride={false}
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[withTodos]}
        labels={labels}
        documentBlocks={[]}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Überwachung der Umsetzung" })).toBeDisabled();
  });
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

describe("requirements without an assessment", () => {
  const documentBlocks = [
    {
      id: "block-1",
      blockKey: "p1-a1",
      ordinal: 1,
      blockType: "paragraph",
      canonicalText: "Vorher Das Leitungsorgan genehmigt den Rahmen. Nachher",
      headingPath: ["Governance"],
      pageNumber: 1,
      paragraphNumber: 1,
    },
  ];
  const pendingItem = {
    ...item,
    aiStatus: "no_assessment_possible" as const,
    status: "no_assessment_possible" as const,
    explanation: "",
    confidencePercent: 0,
    verificationStatus: "pending" as const,
    pending: true,
  };

  it("states that the requirement is not assessed yet and estimates nothing", () => {
    render(
      <AnalysisResultsWorkspace
        analysisId="preview"
        canConfirm
        canOverride
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[pendingItem]}
        labels={labels}
        documentBlocks={documentBlocks}
      />,
    );

    expect(screen.getAllByText("Noch nicht bewertet").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Diese Anforderung wartet auf die Bewertung durch das Modell."),
    ).toBeInTheDocument();
    // Kein geschätzter Status und keine erfundenen Belegstellen vor dem Lauf.
    expect(screen.queryByText("Keine Einschätzung möglich")).not.toBeInTheDocument();
    expect(screen.getByText("Belegstellen entstehen mit der Bewertung.")).toBeInTheDocument();
    // Ohne Bewertung gibt es weder Bestätigung noch Override und keinen Export.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Status ändern" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Excel/u })).not.toBeInTheDocument();
  });

  it("shows the policy text it was given without fetching the document again", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AnalysisResultsWorkspace
        analysisId="preview"
        canConfirm={false}
        canOverride={false}
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[pendingItem]}
        labels={labels}
        documentBlocks={documentBlocks}
      />,
    );

    expect(
      screen.getByText("Vorher Das Leitungsorgan genehmigt den Rahmen. Nachher"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("mark")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
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

describe("live results during a run", () => {
  it("replaces a pending requirement as soon as the run delivers its assessment", () => {
    const pending = {
      ...item,
      id: "pending-1",
      aiStatus: "no_assessment_possible" as const,
      status: "no_assessment_possible" as const,
      explanation: "",
      pending: true,
    };
    const view = render(
      <AnalysisResultsWorkspace
        analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
        canConfirm={false}
        canOverride={false}
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[pending]}
        labels={labels}
        documentBlocks={[]}
      />,
    );

    expect(screen.getAllByText("Noch nicht bewertet").length).toBeGreaterThan(0);

    // Der Server liefert dieselbe Anforderung bewertet nach — ohne Neuladen.
    view.rerender(
      <AnalysisResultsWorkspace
        analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
        canConfirm={false}
        canOverride={false}
        policyName="IKT-Sicherheitsrichtlinie.docx"
        organizationContext=""
        items={[{ ...item, id: "result-1" }]}
        labels={labels}
        documentBlocks={[]}
      />,
    );

    expect(screen.queryByText("Noch nicht bewertet")).not.toBeInTheDocument();
    expect(screen.getByText("Die laufende Überwachung ist nicht belegt.")).toBeInTheDocument();
    expect(screen.getAllByText("Teilweise erfüllt").length).toBeGreaterThan(0);
  });
});
