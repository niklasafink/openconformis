import { describe, expect, it } from "vitest";

import { filterFrameworks, getIncludedFramework } from "@/domain/frameworks/catalog";

describe("framework catalogue", () => {
  it("finds frameworks by alias", () => {
    expect(filterFrameworks("geldwäsche").map((framework) => framework.id)).toEqual(["eu-aml"]);
  });

  it("never resolves a locked framework as selectable", () => {
    expect(getIncludedFramework("nis2")).toBeUndefined();
    expect(getIncludedFramework("dora")?.name).toBe("DORA");
  });
});
