import { describe, expect, it } from "vitest";

import {
  ModelProviderError,
  readProviderErrorDetail,
  readProviderJson,
  retryableProviderStatus,
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
});
