import { describe, expect, it } from "vitest";

import {
  blobApiOrigin,
  blobStorageOrigin,
  buildContentSecurityPolicy,
} from "./content-security-policy";

function directive(policy: string, name: string) {
  return policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
}

describe("buildContentSecurityPolicy", () => {
  it("allows both hosts a browser upload to the private blob store needs", () => {
    // Nur der Speicherhost reichte nicht: der Upload wird über die Blob-API
    // ausgehandelt, und ohne sie scheiterte jedes eigene Dokument still.
    const connect = directive(buildContentSecurityPolicy(false), "connect-src");
    expect(connect).toContain(blobApiOrigin);
    expect(connect).toContain(blobStorageOrigin);
  });

  it("keeps the policy closed for everything that is not needed", () => {
    const policy = buildContentSecurityPolicy(false);
    expect(directive(policy, "default-src")).toBe("default-src 'self'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("permits eval only while developing", () => {
    expect(buildContentSecurityPolicy(true)).toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy(false)).not.toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy(true)).not.toContain("upgrade-insecure-requests");
  });
});
