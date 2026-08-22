import { describe, expect, it } from "vitest";

import { resolveCatalogueDriver } from "./driver";

describe("catalogue driver", () => {
  it("uses fixtures unless database mode is explicitly configured", () => {
    expect(resolveCatalogueDriver(undefined, false)).toBe("fixture");
  });

  it("accepts database mode only with an explicit database connection", () => {
    expect(resolveCatalogueDriver("database", true)).toBe("database");
    expect(() => resolveCatalogueDriver("database", false)).toThrow(
      "CATALOGUE_DRIVER=database requires DATABASE_URL.",
    );
  });

  it("rejects silent fallback for unknown drivers", () => {
    expect(() => resolveCatalogueDriver("auto", true)).toThrow(
      "Unsupported CATALOGUE_DRIVER value",
    );
  });
});
