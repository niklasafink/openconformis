// @vitest-environment node

import { FatalError, RetryableError } from "workflow";
import { describe, expect, it } from "vitest";

import { ProviderRouteConfigurationError } from "@/server/ai/provider-routing";
import { ModelProviderError } from "@/server/ai/structured-model";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";

import { reviewTerminalIfPermanent } from "./review-errors";

function thrownBy(error: unknown) {
  try {
    reviewTerminalIfPermanent(error);
  } catch (thrown) {
    return thrown;
  }
  return undefined;
}

describe("review step errors", () => {
  it("waits as long as the provider asks when it throttles", () => {
    const thrown = thrownBy(new ModelProviderError("PROVIDER_RATE_LIMITED", true, undefined, 12));
    expect(thrown).toBeInstanceOf(RetryableError);
    const retryAt = (thrown as RetryableError).retryAfter.getTime() - Date.now();
    expect(retryAt).toBeGreaterThan(10_000);
    expect(retryAt).toBeLessThanOrEqual(12_500);
  });

  it("falls back to a short wait when the provider names none", () => {
    const thrown = thrownBy(new ModelProviderError("PROVIDER_RATE_LIMITED", true));
    expect(thrown).toBeInstanceOf(RetryableError);
  });

  it.each([
    new ModelProviderError("PROVIDER_CREDENTIAL_INVALID", false),
    new ModelProviderError("PROVIDER_REQUEST_INVALID", false),
    new TemporaryCredentialError("BYOK_CREDENTIAL_NOT_FOUND"),
    new ProviderRouteConfigurationError("ANALYSIS_ROUTE_UNAVAILABLE"),
  ])("ends the run for an error that would fail the same way again: %s", (error) => {
    expect(thrownBy(error)).toBeInstanceOf(FatalError);
  });

  it("lets a temporary outage and unknown errors retry", () => {
    const outage = new ModelProviderError("PROVIDER_UNAVAILABLE", true);
    expect(thrownBy(outage)).toBe(outage);
    const unknown = new Error("boom");
    expect(thrownBy(unknown)).toBe(unknown);
  });
});
