import { describe, expect, it, vi } from "vitest";

import { hasTrustedApplicationOrigin } from "./trusted-origin";

function requestFrom(origin: string) {
  return new Request("http://localhost:3001/api/analyses/start", {
    method: "POST",
    headers: { origin },
  });
}

describe("hasTrustedApplicationOrigin", () => {
  it("accepts the configured origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    expect(hasTrustedApplicationOrigin(requestFrom("https://app.example.com"))).toBe(true);
  });

  it("rejects a foreign origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    expect(hasTrustedApplicationOrigin(requestFrom("https://attacker.example"))).toBe(false);
  });

  // Der Entwicklungsserver weicht auf den nächsten freien Port aus, sobald der
  // konfigurierte belegt ist. Ohne diese Toleranz beantwortet lokal jeder
  // Upload und jeder Analysestart die eigene Oberfläche mit 403.
  it("accepts a differing port on the configured host in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(hasTrustedApplicationOrigin(requestFrom("http://localhost:3001"))).toBe(true);
  });

  it("keeps the port strict in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    expect(hasTrustedApplicationOrigin(requestFrom("https://app.example.com:8443"))).toBe(false);
  });

  it("still separates localhost from 127.0.0.1 in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(hasTrustedApplicationOrigin(requestFrom("http://127.0.0.1:3000"))).toBe(false);
  });
});
