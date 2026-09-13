import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";

import {
  AnalysisNotificationsButton,
  AnalysisRerunControls,
  AnalysisRunHeaderProvider,
  AnalysisRunHeaderStatus,
} from "./analysis-run-header";
import type { AnalysisRunState } from "./analysis-run-live";
import { RequirementSelectionProvider } from "./requirement-selection";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const labels = {
  status: {
    queued: "In Warteschlange",
    running: "In Bearbeitung",
    completed: "Abgeschlossen",
    failed: "Fehlgeschlagen",
    cancelled: "Abgebrochen",
  },
  stage: {
    queued: "Vorbereiten",
    preprocessing: "Dokument aufbereiten",
    retrieval: "Belegstellen ermitteln",
    assessment: "Anforderungen bewerten",
    verification: "Bewertungen verifizieren",
    finalizing: "Ergebnis aufbereiten",
    completed: "Abgeschlossen",
  },
  failureUnknown: "Die Ursache wurde nicht festgehalten.",
  pollingFailed: "Der Status konnte kurzzeitig nicht aktualisiert werden.",
  progressLabel: "Fortschritt der Analyse",
  assessedCount: "{assessed} von {total} bewertet",
  notifications: "Benachrichtigungen",
  noNotifications: "Keine Benachrichtigungen",
  dismiss: "Meldung ausblenden",
  showNotice: "Wieder anzeigen",
  newAnalysis: "Neue Analyse",
  newAnalysisAll: "Alle Anforderungen",
  newAnalysisSelection: "Nur Auswahl ({count})",
  startSelection: "Auswahl analysieren ({count})",
  cancelledNotice: "Die Analyse wurde abgebrochen.",
  stop: "Analyse abbrechen",
  stopping: "Wird abgebrochen …",
  stopFailed: "Die Analyse konnte nicht abgebrochen werden.",
  restart: "Analyse neu starten",
};

const accessLabels = {
  panelTitle: "Modellzugang",
  model: "Modell",
  selected: "Ausgewählt",
  apiKey: "API-Key",
  keyFailed: "Der Schlüssel konnte nicht bestätigt werden.",
  keyErrors: { CREDENTIAL_REJECTED: "Der Anbieter lehnt den Schlüssel ab." },
  modelFailed: "Das Modell konnte nicht übernommen werden.",
  start: "Analyse starten",
  starting: "Analyse startet …",
  startFailed: "Die Analyse konnte nicht gestartet werden.",
};

const catalogue: AnalysisModelCatalogue = {
  version: "a".repeat(64),
  fetchedAt: "2026-09-13T00:00:00.000Z",
  models: [
    {
      id: "openrouter:anthropic/claude-sonnet-5",
      name: "Claude Sonnet 5",
      publisher: "Anthropic",
      routeProvider: "openrouter",
      providerModelId: "anthropic/claude-sonnet-5",
      evaluated: true,
    },
  ],
} as AnalysisModelCatalogue;

const analysisId = "3d594650-3436-4d0d-969e-a3b712c02ed0";
const providerError = "HTTP 402: This request would exceed your available credits.";

function renderHeader(
  initialState: AnalysisRunState = {
    status: "failed",
    stage: "assessment",
    progressPercent: 41,
  },
) {
  return render(
    <RequirementSelectionProvider
      requirementKeys={["dora-art-5", "dora-art-6", "dora-art-9"]}
      labels={{ selectAll: "Alle Anforderungen auswählen", select: "{requirement} auswählen" }}
    >
      <AnalysisRunHeaderProvider
        analysisId={analysisId}
        initialState={initialState}
        failure={{ code: "PROVIDER_REQUEST_FAILED", detail: providerError }}
        labels={labels}
      >
        <AnalysisRunHeaderStatus assessed={1} total={10} />
        <AnalysisRerunControls
          catalogue={catalogue}
          initialModelProfileId="openrouter:anthropic/claude-sonnet-5"
          labels={accessLabels}
          lastFour={null}
          locale="de"
        />
        <AnalysisNotificationsButton />
      </AnalysisRunHeaderProvider>
    </RequirementSelectionProvider>,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("analysis run header", () => {
  it("shows progress and the provider error with a way to start a new analysis", async () => {
    renderHeader();

    expect(screen.getByText("41 %")).toBeInTheDocument();
    expect(screen.getByText("1/10")).toHaveAttribute("title", "1 von 10 bewertet");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Fehlgeschlagen");
    expect(alert).toHaveTextContent(providerError);
    expect(screen.getByRole("button", { name: "Benachrichtigungen (1)" })).toBeInTheDocument();
    // Ein beendeter Lauf lässt sich nicht mehr abbrechen.
    expect(screen.queryByRole("button", { name: "Analyse abbrechen" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Neue Analyse" })[0]!);
    expect(await screen.findByLabelText("API-Key")).toBeInTheDocument();
    expect(screen.getByLabelText("Modell")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyse starten" })).toBeDisabled();
  });

  it("starts a new run with the chosen model and key and opens it", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ analysisId: "8a0e2f0c-54a6-4c1e-9d0e-2b5f6c7d8e9f", status: "queued" }, 202),
    );
    renderHeader({ status: "completed", stage: "completed", progressPercent: 100 });

    fireEvent.click(screen.getByTitle("Modellzugang"));
    // Das Dropdown nennt das gewählte Modell; grün wird es erst mit einem Schlüssel.
    const keyInput = await screen.findByLabelText("API-Key");
    const modelTrigger = screen.getByLabelText("Modell");
    expect(modelTrigger).toHaveTextContent("Claude Sonnet 5");
    expect(modelTrigger).toHaveAttribute("data-key-provided", "false");
    fireEvent.change(keyInput, { target: { value: "sk-or-v1-secret-key" } });
    expect(modelTrigger).toHaveAttribute("data-key-provided", "true");
    // Die Eingabetaste im Schlüsselfeld startet nichts; erst der Klick zählt.
    fireEvent.keyDown(keyInput, { key: "Enter", code: "Enter" });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Analyse starten" }));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/de/analyses/8a0e2f0c-54a6-4c1e-9d0e-2b5f6c7d8e9f"),
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`/api/analyses/${analysisId}/rerun`);
    expect(JSON.parse(String(init?.body))).toEqual({
      modelProfileId: "openrouter:anthropic/claude-sonnet-5",
      modelCatalogueVersion: catalogue.version,
      unevaluatedWarningAccepted: true,
      apiKey: "sk-or-v1-secret-key",
    });
  });

  it("starts a new run for the selected requirements only", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ analysisId: "8a0e2f0c-54a6-4c1e-9d0e-2b5f6c7d8e9f", status: "queued" }, 202),
    );
    renderHeader({ status: "completed", stage: "completed", progressPercent: 100 });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Neue Analyse" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Nur Auswahl (3)" }));
    fireEvent.change(await screen.findByLabelText("API-Key"), {
      target: { value: "sk-or-v1-secret-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Auswahl analysieren (3)" }));

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      requirementKeys: ["dora-art-5", "dora-art-6", "dora-art-9"],
    });
  });

  it("names the provider's reason when the key is rejected", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: "CREDENTIAL_REJECTED" }, 422));
    renderHeader({ status: "completed", stage: "completed", progressPercent: 100 });

    fireEvent.click(screen.getByTitle("Modellzugang"));
    fireEvent.change(await screen.findByLabelText("API-Key"), {
      target: { value: "sk-or-v1-wrong-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyse starten" }));

    expect(await screen.findByText(/Der Anbieter lehnt den Schlüssel ab/u)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("cancels a running analysis from the same place as a new analysis", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: "cancelled", changed: true }));
    renderHeader({ status: "running", stage: "assessment", progressPercent: 50 });

    expect(screen.queryByRole("button", { name: "Neue Analyse" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analyse abbrechen" }));

    expect(await screen.findByText("Die Analyse wurde abgebrochen.")).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `/api/analyses/${analysisId}/cancel`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.queryByRole("button", { name: "Analyse abbrechen" })).not.toBeInTheDocument();
  });

  it("moves a dismissed error into the notifications and keeps it dismissed after a reload", async () => {
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Meldung ausblenden" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Benachrichtigungen (1)" }));
    expect(await screen.findByText(providerError)).toBeInTheDocument();

    cleanup();
    renderHeader();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists no notification while the run is healthy", async () => {
    render(
      <AnalysisRunHeaderProvider
        analysisId="0f3b8a47-65f8-4b8a-9d8e-1f6b3a0b2c11"
        initialState={{ status: "completed", stage: "completed", progressPercent: 100 }}
        failure={{ code: null, detail: null }}
        labels={labels}
      >
        <AnalysisNotificationsButton />
      </AnalysisRunHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Benachrichtigungen" }));
    expect(await screen.findByText("Keine Benachrichtigungen")).toBeInTheDocument();
  });
});
