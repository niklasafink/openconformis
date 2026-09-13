import { describe, expect, it, vi } from "vitest";

import {
  fetchProviderJson,
  ModelProviderError,
  readProviderErrorDetail,
  readProviderJson,
  retryableProviderStatus,
  withProviderErrorContext,
} from "./structured-model";

describe("readProviderErrorDetail", () => {
  it("reads the nested error message providers return", () => {
    // Echte Antwort von OpenRouter, mitgeschnitten gegen den EU-Endpunkt.
    expect(
      readProviderErrorDetail({
        error: {
          message:
            "Regional routing not enabled for this account. Please reach out to our enterprise sales team to enable this feature.",
          code: 403,
        },
      }),
    ).toContain("Regional routing not enabled");
  });

  it("reads a flat message and a plain string body", () => {
    expect(readProviderErrorDetail({ message: "model not found" })).toBe("model not found");
    expect(readProviderErrorDetail({ error: "invalid api key" })).toBe("invalid api key");
    expect(readProviderErrorDetail("upstream unavailable")).toBe("upstream unavailable");
  });

  it("caps the message so a large body cannot flood the record", () => {
    const detail = readProviderErrorDetail({ error: { message: "x".repeat(5_000) } });
    expect(detail).toHaveLength(200);
  });

  it("returns nothing when no message is present", () => {
    expect(readProviderErrorDetail({})).toBeUndefined();
    expect(readProviderErrorDetail(null)).toBeUndefined();
    expect(readProviderErrorDetail({ error: {} })).toBeUndefined();
  });
});

describe("retryableProviderStatus", () => {
  it("retries only what can succeed on a second attempt", () => {
    expect(retryableProviderStatus(429)).toBe(true);
    expect(retryableProviderStatus(503)).toBe(true);
    expect(retryableProviderStatus(408)).toBe(true);
    // Eine gesperrte Route, ein ungültiger Schlüssel oder ein unbekanntes Modell
    // fällt beim nächsten Versuch genauso aus.
    expect(retryableProviderStatus(403)).toBe(false);
    expect(retryableProviderStatus(401)).toBe(false);
    expect(retryableProviderStatus(400)).toBe(false);
    expect(retryableProviderStatus(404)).toBe(false);
  });
});

describe("readProviderJson", () => {
  it("carries the provider reason and the status into the error", async () => {
    const response = new Response(
      JSON.stringify({ error: { message: "Regional routing not enabled for this account." } }),
      { status: 403 },
    );

    await expect(readProviderJson(response)).rejects.toMatchObject({
      code: "PROVIDER_HTTP_ERROR",
      retryable: false,
    });
  });

  it("waits for OpenRouter's in-flight credit reservation, but not for missing credit", async () => {
    const waiting = new Response(
      JSON.stringify({
        error: {
          message:
            "This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests complete.",
        },
      }),
      { status: 402 },
    );
    await expect(readProviderJson(waiting)).rejects.toMatchObject({ retryable: true });

    const exhausted = new Response(
      JSON.stringify({ error: { message: "Insufficient credits." } }),
      {
        status: 402,
      },
    );
    await expect(readProviderJson(exhausted)).rejects.toMatchObject({ retryable: false });
  });

  it("states the status even when the body carries no message", async () => {
    const response = new Response("not json at all", { status: 502 });
    try {
      await readProviderJson(response);
      expect.unreachable("readProviderJson should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProviderError);
      expect((error as ModelProviderError).detail).toBe("HTTP 502");
      expect((error as ModelProviderError).retryable).toBe(true);
    }
  });

  it("passes a successful payload through", async () => {
    const response = new Response(JSON.stringify({ id: "gen-1" }), { status: 200 });
    await expect(readProviderJson(response)).resolves.toEqual({ id: "gen-1" });
  });

  it("describes a body that is not JSON without echoing it, and allows a retry", async () => {
    const response = new Response('{"choices": [{"message": "Auszug aus der Policy', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    try {
      await readProviderJson(response);
      expect.unreachable("readProviderJson should have thrown");
    } catch (error) {
      expect(error).toMatchObject({ code: "PROVIDER_RESPONSE_INVALID", retryable: true });
      expect((error as ModelProviderError).detail).toContain("kein gültiges JSON (HTTP 200");
      expect((error as ModelProviderError).detail).not.toContain("Policy");
    }
  });
});

describe("withProviderErrorContext", () => {
  it("names where the error arose and its code while keeping retry semantics", () => {
    const error = withProviderErrorContext(
      new ModelProviderError("PROVIDER_RESPONSE_INVALID", true, "leere Antwort"),
      "Art. 6, Verifikation (Versuch 1), anthropic/claude-sonnet-5",
    );
    expect(error).toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
      retryable: true,
      detail:
        "Art. 6, Verifikation (Versuch 1), anthropic/claude-sonnet-5: leere Antwort [PROVIDER_RESPONSE_INVALID]",
    });
  });

  it("leaves errors from outside the provider untouched", () => {
    const error = new Error("ANALYSIS_NOT_FOUND");
    expect(withProviderErrorContext(error, "Art. 6")).toBe(error);
  });
});

describe("ModelProviderError", () => {
  it("explains itself even when the provider gave no message", () => {
    // Genau dieser Fall stand im Ergebnis nur als "ANALYSIS_RETRIES_EXHAUSTED":
    // eine Basis-URL, die nicht zum gewählten Anbieter gehört.
    const error = new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
    expect(error.detail).toContain("Basis-URL");
    expect(error.message).toBe(error.detail);
  });

  it("prefers the provider message when there is one", () => {
    const error = new ModelProviderError("PROVIDER_HTTP_ERROR", false, "HTTP 403: nope");
    expect(error.detail).toBe("HTTP 403: nope");
  });

  it("names the token limit when the model truncated its answer", () => {
    expect(new ModelProviderError("PROVIDER_OUTPUT_INCOMPLETE", false).detail).toContain(
      "Token-Obergrenze",
    );
  });
});

describe("fetchProviderJson", () => {
  it("gives up on a stalled provider instead of waiting indefinitely", async () => {
    // Zwei echte Aufrufe blieben 408 und 929 Sekunden haengen, obwohl 120
    // Sekunden gesetzt waren; das Abbruchsignal allein greift dort nicht.
    const stalled = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {}));

    await expect(
      fetchProviderJson(new URL("https://provider.invalid/v1"), {}, stalled, 40),
    ).rejects.toMatchObject({ code: "PROVIDER_HTTP_ERROR", retryable: true });
  });

  it("names the wait in the reason so the limit is visible", async () => {
    const stalled = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {}));
    try {
      await fetchProviderJson(new URL("https://provider.invalid/v1"), {}, stalled, 40);
      expect.unreachable("fetchProviderJson should have given up");
    } catch (error) {
      expect((error as ModelProviderError).detail).toContain("nicht geantwortet");
    }
  });
});
