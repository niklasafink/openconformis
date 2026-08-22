import { describe, expect, it } from "vitest";

import { buildOcrArguments } from "./ocr-runner";

describe("buildOcrArguments", () => {
  it("uses an argument array and keeps input/output paths as distinct final arguments", () => {
    const args = buildOcrArguments("/tmp/input file.pdf", "/tmp/output file.pdf");

    expect(args.slice(-2)).toEqual(["/tmp/input file.pdf", "/tmp/output file.pdf"]);
    expect(args).toContain("--skip-text");
    expect(args).toContain("deu+eng");
  });
});
