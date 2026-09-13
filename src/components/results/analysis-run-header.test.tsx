import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnalysisNotificationsButton,
  AnalysisRunHeaderProvider,
  AnalysisRunHeaderStatus,
} from "./analysis-run-header";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
};

const providerError = "HTTP 402: This request would exceed your available credits.";

function renderHeader() {
  return render(
    <AnalysisRunHeaderProvider
      analysisId="3d594650-3436-4d0d-969e-a3b712c02ed0"
      initialState={{ status: "failed", stage: "assessment", progressPercent: 41 }}
      failure={{ code: "PROVIDER_REQUEST_FAILED", detail: providerError }}
      labels={labels}
      newAnalysisHref="/de/analyses/new/framework"
    >
      <AnalysisRunHeaderStatus assessed={1} total={10} />
      <AnalysisNotificationsButton />
    </AnalysisRunHeaderProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("analysis run header", () => {
  it("shows progress and the provider error with a way to start a new analysis", () => {
    renderHeader();

    expect(screen.getByText("41 %")).toBeInTheDocument();
    expect(screen.getByText("1/10")).toHaveAttribute("title", "1 von 10 bewertet");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Fehlgeschlagen");
    expect(alert).toHaveTextContent(providerError);
    expect(screen.getByRole("link", { name: "Neue Analyse" })).toHaveAttribute(
      "href",
      "/de/analyses/new/framework",
    );
    expect(screen.getByRole("button", { name: "Benachrichtigungen (1)" })).toBeInTheDocument();
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
        newAnalysisHref="/de/analyses/new/framework"
      >
        <AnalysisNotificationsButton />
      </AnalysisRunHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Benachrichtigungen" }));
    expect(await screen.findByText("Keine Benachrichtigungen")).toBeInTheDocument();
  });
});
