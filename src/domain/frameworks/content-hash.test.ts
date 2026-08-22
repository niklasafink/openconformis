import { describe, expect, it } from "vitest";

import { createContentHash } from "./content-hash";

describe("catalogue content hashing", () => {
  it("is independent from object key insertion order", () => {
    expect(createContentHash({ title: "DORA", order: 1 })).toBe(
      createContentHash({ order: 1, title: "DORA" }),
    );
  });

  it("changes when ordered regulatory content changes", () => {
    expect(createContentHash([{ id: "a", order: 1 }])).not.toBe(
      createContentHash([{ id: "a", order: 2 }]),
    );
  });
});
