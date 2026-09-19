/**
 * Doppelter Token-Eimer für Jev.
 *
 * TypeSafe erlaubt 1200 Requests/min **und** 250k Token/s. Beide Grenzen liegen bei
 * einem vollen Lauf in derselben Größenordnung, und keine der beiden reicht allein:
 * ein reiner Request-Zähler reißt bei 32k-Zuständen den Token-Durchsatz, ein reiner
 * Token-Zähler bei vielen kleinen Zuständen den Request-Zähler.
 *
 * Weil die Kind-Läufe in getrennten Funktionsinstanzen laufen, wird der Anteil
 * **statisch aufgeteilt** statt verteilt gezählt. Ein gemeinsamer Eimer in der
 * Datenbank wären über tausend zusätzliche Roundtrips je Lauf — genau die Flut, die
 * das Live-Raster vermeidet.
 */

export type JevThrottleOptions = {
  /** Anteil dieses Kind-Laufs an den Requests je Sekunde. */
  requestsPerSecond: number;
  /** Anteil dieses Kind-Laufs an den Eingabe-Token je Sekunde. */
  tokensPerSecond: number;
  /** Höchstzahl gleichzeitig offener Jev-Anfragen dieses Kind-Laufs. */
  maxConcurrent: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

/** Statische Aufteilung je Kind-Lauf bei acht gleichzeitigen Verträgen je Welle. */
export const defaultJevThrottleOptions: JevThrottleOptions = {
  requestsPerSecond: 2,
  tokensPerSecond: 25_000,
  maxConcurrent: 2,
};

type Bucket = { available: number; capacity: number; ratePerSecond: number; lastRefillAt: number };

function refill(bucket: Bucket, now: number) {
  const elapsedSeconds = Math.max(0, now - bucket.lastRefillAt) / 1000;
  bucket.available = Math.min(
    bucket.capacity,
    bucket.available + elapsedSeconds * bucket.ratePerSecond,
  );
  bucket.lastRefillAt = now;
}

/** Wartezeit, bis der Eimer `cost` hergibt. */
function waitMilliseconds(bucket: Bucket, cost: number) {
  if (bucket.available >= cost) return 0;
  return Math.ceil(((cost - bucket.available) / bucket.ratePerSecond) * 1000);
}

export type JevThrottle = {
  /** Hält an, bis Request- und Token-Anteil für diesen Aufruf frei sind. */
  run<T>(inputTokens: number, call: () => Promise<T>): Promise<T>;
  /** Meldet eine Ablehnung des Anbieters und pausiert beide Eimer entsprechend. */
  penalize(retryAfterSeconds: number): void;
};

export function createJevThrottle(
  options: JevThrottleOptions = defaultJevThrottleOptions,
): JevThrottle {
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  const requests: Bucket = {
    available: options.requestsPerSecond,
    capacity: options.requestsPerSecond,
    ratePerSecond: options.requestsPerSecond,
    lastRefillAt: now(),
  };
  const tokens: Bucket = {
    available: options.tokensPerSecond,
    capacity: options.tokensPerSecond,
    ratePerSecond: options.tokensPerSecond,
    lastRefillAt: now(),
  };

  /**
   * Die Vergabe wird serialisiert. Ohne das prüften nebenläufige Aufrufer denselben
   * Füllstand und liefen gemeinsam durch, obwohl nur einer hineingepasst hätte.
   */
  let gate: Promise<void> = Promise.resolve();
  let pausedUntil = 0;

  async function acquire(inputTokens: number) {
    const cost = Math.max(1, Math.ceil(inputTokens));
    // Eine einzelne Anfrage darf nie mehr verlangen, als der Eimer je fasst,
    // sonst wartete sie ewig.
    const tokenCost = Math.min(cost, tokens.capacity);
    const previous = gate;
    let release!: () => void;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      for (;;) {
        const current = now();
        refill(requests, current);
        refill(tokens, current);
        const wait = Math.max(
          Math.max(0, pausedUntil - current),
          waitMilliseconds(requests, 1),
          waitMilliseconds(tokens, tokenCost),
        );
        if (wait <= 0) {
          requests.available -= 1;
          tokens.available -= tokenCost;
          return;
        }
        await sleep(wait);
      }
    } finally {
      release();
    }
  }

  /**
   * Semaphore, die den Platz beim Freigeben **weiterreicht**, statt ihn zurückzugeben
   * und alle Wartenden zu wecken. Ein geweckter Wartender, der seinen Platz erst
   * danach zählt, könnte sonst von einem dazwischen eintreffenden Aufruf überholt
   * werden — und die Grenze wäre keine.
   */
  let active = 0;
  const waiters: Array<() => void> = [];

  async function withConcurrencyLimit<T>(call: () => Promise<T>): Promise<T> {
    if (active < options.maxConcurrent) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    try {
      return await call();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    }
  }

  return {
    async run(inputTokens, call) {
      await acquire(inputTokens);
      return withConcurrencyLimit(call);
    },
    penalize(retryAfterSeconds) {
      const until = now() + Math.max(0, Math.min(retryAfterSeconds, 300)) * 1000;
      pausedUntil = Math.max(pausedUntil, until);
    },
  };
}
