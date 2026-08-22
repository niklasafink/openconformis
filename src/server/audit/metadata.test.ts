import { describe, expect, it } from "vitest";

import { createAuditMetadata } from "./metadata";

describe("audit metadata", () => {
  it("accepts bounded operational metadata", () => {
    expect(createAuditMetadata({ revision: 2, source: "user", succeeded: true })).toEqual({
      revision: 2,
      source: "user",
      succeeded: true,
    });
  });

  it.each(["apiKey", "rawPrompt", "policyText", "ipAddress", "token"])(
    "rejects sensitive key %s",
    (key) => {
      expect(() => createAuditMetadata({ [key]: "forbidden" })).toThrow(/forbidden/i);
    },
  );

  it("rejects unbounded text-like metadata values", () => {
    expect(() => createAuditMetadata({ reasonCode: "x".repeat(257) })).toThrow(/too long/i);
  });
});
