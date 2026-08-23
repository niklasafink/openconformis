import { describe, expect, it } from "vitest";

import { assertRequestSize, RequestProtectionError } from "./request-protection";

function requestWithHeaders(headers: Record<string, string>) {
  return new Request("https://example.invalid/api/test", { method: "POST", headers });
}

describe("assertRequestSize", () => {
  it("accepts a declared size within the limit", () => {
    expect(() =>
      assertRequestSize(requestWithHeaders({ "content-length": "1024" }), 16_384),
    ).not.toThrow();
  });

  it("rejects a declared size above the limit", () => {
    expect(() =>
      assertRequestSize(requestWithHeaders({ "content-length": "16385" }), 16_384),
    ).toThrow(RequestProtectionError);
  });

  it("rejects a request that declares no size", () => {
    // Ohne diesen Fall ließe sich die Grenze mit `Transfer-Encoding: chunked`
    // vollständig umgehen, weil ein fehlender Header als 0 gelesen wurde.
    expect(() => assertRequestSize(requestWithHeaders({}), 16_384)).toThrow(RequestProtectionError);
  });

  it("rejects an unparseable or negative declared size", () => {
    expect(() =>
      assertRequestSize(requestWithHeaders({ "content-length": "abc" }), 16_384),
    ).toThrow(RequestProtectionError);
    expect(() => assertRequestSize(requestWithHeaders({ "content-length": "-1" }), 16_384)).toThrow(
      RequestProtectionError,
    );
  });

  it("reports the size failure with its own code", () => {
    try {
      assertRequestSize(requestWithHeaders({}), 16_384);
      expect.unreachable("assertRequestSize should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RequestProtectionError);
      expect((error as RequestProtectionError).code).toBe("REQUEST_TOO_LARGE");
    }
  });
});
