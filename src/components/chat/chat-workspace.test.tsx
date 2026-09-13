import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisModelCatalogue } from "@/domain/ai/model-catalogue";

import { ChatWorkspace } from "./chat-workspace";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const labels = {
  title: "Wie kann ich helfen?",
  greeting: "Hi, {name}",
  placeholder: "Frage stellen",
  framework: "Rahmenwerk",
  noFramework: "Kein Rahmenwerk ausgewählt",
  frameworkHint: "Quellen des Rahmenwerks",
  model: "Modell",
  modelHint: "Modell wählen",
  send: "Senden",
  sources: "Quellen",
  noSources: "Keine Quelle",
  noKey: "Kein API-Key",
  keyConnected: "Key ••••{lastFour}",
  apiKey: "API-Key",
  connect: "Verbinden",
  failed: "Die Anfrage konnte nicht sicher verarbeitet werden.",
  emptyModels: "Kein Chatmodell.",
  disclaimer: "KI kann Fehler machen.",
};

const catalogue = {
  version: "test",
  fetchedAt: "2026-09-13T00:00:00.000Z",
  models: [
    {
      id: "profile-unevaluated",
      name: "Test Model",
      publisher: "Test Publisher",
      routeProvider: "openrouter",
      providerModelId: "test/model",
      evaluated: false,
    },
  ],
} as unknown as AnalysisModelCatalogue;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("chat workspace", () => {
  it("connects a key typed straight into the key popover and shows it as connected", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        credentialId: "credential-1",
        provider: "openrouter",
        lastFour: "1234",
        accessibleModelIds: ["test/model"],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ChatWorkspace
        locale="de"
        catalogue={catalogue}
        frameworks={[]}
        initialCredentials={[]}
        labels={labels}
      />,
    );

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Kein API-Key/u }));
    fireEvent.change(await screen.findByLabelText("API-Key"), {
      target: { value: "sk-or-v1-secret-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));

    await waitFor(() => expect(screen.getByText("Key ••••1234")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai-credentials",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
