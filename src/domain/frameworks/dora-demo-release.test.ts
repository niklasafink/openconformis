import { describe, expect, it } from "vitest";

import { doraDemoRelease } from "./dora-demo-release";
import { frameworkReleaseSeedSchema } from "./release-schema";

describe("DORA demo release", () => {
  it("is valid and contains ten parent requirements", () => {
    const parsed = frameworkReleaseSeedSchema.parse(doraDemoRelease);

    expect(parsed.requirements).toHaveLength(10);
  });

  it("contains distinct size guidance for every catalogue item", () => {
    const parsed = frameworkReleaseSeedSchema.parse(doraDemoRelease);
    const items = parsed.requirements.flatMap((requirement) => [
      requirement,
      ...requirement.subrequirements,
    ]);

    for (const item of items) {
      expect(new Set(Object.values(item.sizeGuidance)).size).toBe(3);
    }
  });

  it("is explicitly classified as non-verified demo content", () => {
    const parsed = frameworkReleaseSeedSchema.parse(doraDemoRelease);

    expect(parsed.release.contentClassification).toBe("demo");
    expect(parsed.release.provenanceNote).toContain("Nicht rechtsverbindlich verifiziert");
  });
});
