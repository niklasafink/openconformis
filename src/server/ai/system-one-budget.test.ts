// @vitest-environment node

import { describe, expect, it } from "vitest";

import { systemOneLimits, type SystemOneQuestion } from "@/domain/ai/system-one";

import {
  blockTokenCount,
  composeState,
  planStateBudget,
  questionTokenCount,
  stateBudgetFor,
  type BudgetBlock,
} from "./system-one-budget";

function block(
  key: string,
  tokenCount: number | null,
  text = "x".repeat(tokenCount ?? 0),
): BudgetBlock {
  return { blockKey: key, tokenCount, canonicalText: text };
}

const shortQuestion: SystemOneQuestion = {
  type: "noul",
  instructions: "Does the contract cap liability?",
  criteria: { true: "A cap is stated.", false: "No cap is stated." },
};

describe("System One state budget", () => {
  it("never exceeds the budget", () => {
    const plan = planStateBudget({
      blocks: [block("b1", 400), block("b2", 400), block("b3", 400)],
      budgetTokens: 900,
    });

    expect(plan.blockKeys).toEqual(["b1", "b2"]);
    expect(plan.tokenCount).toBe(800);
    expect(plan.tokenCount).toBeLessThanOrEqual(plan.budgetTokens);
    expect(plan.omittedBlockKeys).toEqual(["b3"]);
    expect(plan.emptyReason).toBeUndefined();
  });

  it("gives an explicit empty message when one block alone is larger than the budget", () => {
    // Sonst entstünde ein abgeschnittenes Zitat, das im Originaldokument so nicht
    // steht — genau das verbietet die Belegregel.
    const plan = planStateBudget({
      blocks: [block("huge", 40_000)],
      budgetTokens: systemOneLimits.stateTokens,
    });

    expect(plan.blockKeys).toEqual([]);
    expect(plan.tokenCount).toBe(0);
    expect(plan.emptyReason).toBe("first_block_too_large");
  });

  it("reports an empty document as such, not as an exhausted budget", () => {
    expect(planStateBudget({ blocks: [], budgetTokens: 1_000 }).emptyReason).toBe("no_blocks");
  });

  it("keeps a later small block out once the budget is full rather than reordering", () => {
    const plan = planStateBudget({
      blocks: [block("b1", 900), block("b2", 10), block("b3", 10)],
      budgetTokens: 905,
    });

    expect(plan.blockKeys).toEqual(["b1"]);
    expect(plan.omittedBlockKeys).toEqual(["b2", "b3"]);
    expect(plan.emptyReason).toBeUndefined();
  });

  it("estimates tokens when the parser left no count", () => {
    expect(blockTokenCount(block("b", null, "a".repeat(350)))).toBe(100);
    expect(blockTokenCount(block("b", 0, "a".repeat(350)))).toBe(100);
  });

  it("reserves room for the longest question, not the average one", () => {
    const longQuestion: SystemOneQuestion = {
      type: "score",
      instructions: "How strictly is liability limited?".repeat(50),
      criteria: ["low".repeat(100), "medium".repeat(100), "high".repeat(100)],
    };

    const budget = stateBudgetFor([shortQuestion, longQuestion]);

    expect(budget).toBeLessThan(systemOneLimits.stateTokens - questionTokenCount(longQuestion));
    expect(budget).toBeGreaterThan(0);
  });

  it("never returns a negative budget when the question alone fills the context", () => {
    const enormous: SystemOneQuestion = {
      type: "noul",
      instructions: "x".repeat(200_000),
      criteria: { true: "a", false: "b" },
    };

    expect(stateBudgetFor([enormous])).toBe(0);
    expect(planStateBudget({ blocks: [block("b1", 10)], budgetTokens: 0 }).emptyReason).toBe(
      "first_block_too_large",
    );
  });

  it("numbers the state so evidence numbers match the rationale and the document", () => {
    const blocks = [block("b1", 3, "Erstens."), block("b2", 3, "Zweitens.")];

    expect(composeState(blocks, ["b1", "b2"])).toBe("[1] Erstens.\n\n[2] Zweitens.");
  });
});
