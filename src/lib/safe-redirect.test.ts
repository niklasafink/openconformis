import { describe, expect, it } from "vitest";

import { safeInternalPath } from "./safe-redirect";

const fallback = "/de/analyses/new/framework";

describe("safeInternalPath", () => {
  it("keeps a localized in-app path including its query", () => {
    expect(safeInternalPath("/de/analyses/new/results?draft=abc", "de")).toBe(
      "/de/analyses/new/results?draft=abc",
    );
    expect(safeInternalPath("/en/analyses/123", "de")).toBe("/en/analyses/123");
  });

  it("falls back when no target was supplied", () => {
    expect(safeInternalPath(undefined, "de")).toBe(fallback);
    expect(safeInternalPath("", "de")).toBe(fallback);
  });

  it("rejects absolute URLs to other origins", () => {
    expect(safeInternalPath("https://evil.example/x", "de")).toBe(fallback);
    expect(safeInternalPath("http://evil.example", "de")).toBe(fallback);
    expect(safeInternalPath("javascript:alert(1)", "de")).toBe(fallback);
  });

  it("rejects protocol-relative targets", () => {
    // `//host` und `/\host` wechseln den Origin, sehen aber wie ein Pfad aus —
    // das ist der klassische Open Redirect im Anmeldepfad.
    expect(safeInternalPath("//evil.example/x", "de")).toBe(fallback);
    expect(safeInternalPath("/\\evil.example/x", "de")).toBe(fallback);
  });

  it("rejects in-app paths without a known locale prefix", () => {
    expect(safeInternalPath("/etc/passwd", "de")).toBe(fallback);
    expect(safeInternalPath("/api/analyses/start", "de")).toBe(fallback);
    expect(safeInternalPath("/fr/analyses", "de")).toBe(fallback);
  });

  it("uses the active locale for the fallback", () => {
    expect(safeInternalPath("https://evil.example", "en")).toBe("/en/analyses/new/framework");
  });
});
