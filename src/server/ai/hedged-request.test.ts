import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hedgedRequest } from "./hedged-request";

type Pending = {
  signal: AbortSignal;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
};

function controllableRun() {
  const calls: Pending[] = [];
  const run = (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => calls.push({ signal, resolve, reject }));
  return { calls, run };
}

describe("hedgedRequest", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends a single request when the first answers before the deadline", async () => {
    const { calls, run } = controllableRun();
    const result = hedgedRequest(run, 1_000);
    calls[0]!.resolve("first");
    await expect(result).resolves.toBe("first");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);
  });

  it("takes the faster answer after a hang and aborts the slower request", async () => {
    const { calls, run } = controllableRun();
    const result = hedgedRequest(run, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    calls[1]!.resolve("second");
    await expect(result).resolves.toBe("second");
    expect(calls[0]!.signal.aborted).toBe(true);
  });

  it("reports an early failure at once instead of hedging it", async () => {
    const { calls, run } = controllableRun();
    const result = hedgedRequest(run, 1_000);
    calls[0]!.reject(new Error("rejected"));
    await expect(result).rejects.toThrow("rejected");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1);
  });

  it("waits for the other request when one fails after the deadline", async () => {
    const { calls, run } = controllableRun();
    const result = hedgedRequest(run, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    calls[0]!.reject(new Error("first failed"));
    calls[1]!.resolve("second");
    await expect(result).resolves.toBe("second");
  });

  it("fails only when both requests failed", async () => {
    const { calls, run } = controllableRun();
    const result = hedgedRequest(run, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    calls[1]!.reject(new Error("second failed"));
    calls[0]!.reject(new Error("first failed"));
    await expect(result).rejects.toThrow("first failed");
  });

  it("does not hedge when disabled", async () => {
    const { calls, run } = controllableRun();
    void hedgedRequest(run, 0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });
});
