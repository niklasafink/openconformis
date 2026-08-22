import { describe, expect, it } from "vitest";

import { doraDemoRelease } from "./dora-demo-release";
import { createFrameworkReleaseHash } from "./release-content";

describe("framework release hashing", () => {
  it("produces a stable SHA-256 hash", () => {
    const first = createFrameworkReleaseHash(doraDemoRelease);
    const second = createFrameworkReleaseHash(structuredClone(doraDemoRelease));

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
  });

  it("covers proportionality guidance", () => {
    const changed = structuredClone(doraDemoRelease);
    const firstRequirement = changed.requirements[0];

    expect(firstRequirement).toBeDefined();
    if (!firstRequirement) return;

    firstRequirement.sizeGuidance.small = "Geänderter Hinweis";

    expect(createFrameworkReleaseHash(changed)).not.toBe(
      createFrameworkReleaseHash(doraDemoRelease),
    );
  });
});
