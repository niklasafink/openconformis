/**
 * Ein zweiter, identischer Aufruf für den Fall, dass der erste ungewöhnlich lange
 * braucht. Anbieter hängen gelegentlich: eine Bewertung, die sonst nach 5 s steht,
 * dauerte im Messlauf 83 s. Die erste Antwort gewinnt, der andere Aufruf wird
 * abgebrochen.
 *
 * Nur die Dauer wird abgesichert, nie ein Fehler: scheitert der erste Aufruf vor
 * Ablauf der Frist, gilt sein Fehler wie bisher und die gewohnte Wiederholung greift.
 */
export function hedgedRequest<T>(
  run: (signal: AbortSignal) => Promise<T>,
  hedgeAfterMilliseconds: number,
): Promise<T> {
  const controllers: AbortController[] = [];
  const attempt = () => {
    const controller = new AbortController();
    controllers.push(controller);
    return new Promise<T>((resolve) => resolve(run(controller.signal)));
  };
  if (hedgeAfterMilliseconds <= 0) return attempt();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let running = 0;
    let hedged = false;
    const timer = setTimeout(() => {
      if (settled) return;
      hedged = true;
      track(attempt());
    }, hedgeAfterMilliseconds);

    function finish() {
      settled = true;
      clearTimeout(timer);
      for (const controller of controllers) controller.abort();
    }

    function track(request: Promise<T>) {
      running += 1;
      request.then(
        (value) => {
          if (settled) return;
          finish();
          resolve(value);
        },
        (error: unknown) => {
          running -= 1;
          if (settled) return;
          // Vor der Frist gilt der Fehler sofort; danach erst, wenn auch der andere scheitert.
          if (!hedged || running === 0) {
            finish();
            reject(error);
          }
        },
      );
    }

    track(attempt());
  });
}
