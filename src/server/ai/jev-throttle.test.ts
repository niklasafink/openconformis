// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createJevThrottle } from "./jev-throttle";

/**
 * Eine gesteuerte Uhr statt echter Wartezeit: der Test prüft, *wie lange* die
 * Drosselung wartet, nicht dass er selbst langsam ist.
 */
function controlledClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (milliseconds: number) => {
      current += milliseconds;
    },
    advance: (milliseconds: number) => {
      current += milliseconds;
    },
    elapsed: () => current,
  };
}

describe("Jev double bucket", () => {
  it("holds the request share", async () => {
    const clock = controlledClock();
    const throttle = createJevThrottle({
      requestsPerSecond: 2,
      tokensPerSecond: 1_000_000,
      maxConcurrent: 4,
      now: clock.now,
      sleep: clock.sleep,
    });

    // Zwei Anfragen passen sofort, die dritte muss auf Nachfüllung warten.
    for (let index = 0; index < 3; index += 1) {
      await throttle.run(10, async () => index);
    }

    expect(clock.elapsed()).toBeGreaterThanOrEqual(500);
  });

  it("holds the token share even when the request count would allow more", async () => {
    const clock = controlledClock();
    const throttle = createJevThrottle({
      requestsPerSecond: 1_000,
      tokensPerSecond: 25_000,
      maxConcurrent: 4,
      now: clock.now,
      sleep: clock.sleep,
    });

    // Ein reiner Request-Zähler ließe diese beiden 20k-Zustände sofort durch und
    // risse den Token-Durchsatz.
    await throttle.run(20_000, async () => "a");
    await throttle.run(20_000, async () => "b");

    expect(clock.elapsed()).toBeGreaterThanOrEqual(600);
  });

  it("does not deadlock on a request larger than the whole bucket", async () => {
    const clock = controlledClock();
    const throttle = createJevThrottle({
      requestsPerSecond: 10,
      tokensPerSecond: 25_000,
      maxConcurrent: 2,
      now: clock.now,
      sleep: clock.sleep,
    });

    await expect(throttle.run(32_000, async () => "ok")).resolves.toBe("ok");
  });

  it("waits for the delay the provider asked for after a rejection", async () => {
    const clock = controlledClock();
    const throttle = createJevThrottle({
      requestsPerSecond: 1_000,
      tokensPerSecond: 1_000_000,
      maxConcurrent: 4,
      now: clock.now,
      sleep: clock.sleep,
    });

    throttle.penalize(5);
    await throttle.run(10, async () => "ok");

    expect(clock.elapsed()).toBeGreaterThanOrEqual(5_000);
  });

  it("keeps at most the configured number of calls open at once", async () => {
    const throttle = createJevThrottle({
      requestsPerSecond: 1_000,
      tokensPerSecond: 1_000_000,
      maxConcurrent: 2,
    });

    let open = 0;
    let peak = 0;
    const release: Array<() => void> = [];

    const calls = Array.from({ length: 6 }, () =>
      throttle.run(10, async () => {
        open += 1;
        peak = Math.max(peak, open);
        await new Promise<void>((resolve) => release.push(resolve));
        open -= 1;
        return true;
      }),
    );

    // Immer nacheinander einen offenen Aufruf freigeben. Käme der Platz nicht bei
    // einem Wartenden an, bliebe `release` leer und der Test liefe in die Zeitgrenze.
    for (let done = 0; done < 6; done += 1) {
      while (release.length === 0) await Promise.resolve();
      release.shift()?.();
      await Promise.resolve();
    }

    await Promise.all(calls);
    expect(peak).toBe(2);
  });
});
