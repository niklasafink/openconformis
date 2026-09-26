import "server-only";

import { z } from "zod";

export type StructuredModelRequest<T> = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  outputSchema: z.ZodType<T>;
  providerOnly?: string[];
  /**
   * Verlangt vom Anbieter Zero Data Retention. Standard ist an — abschalten ist
   * eine bewusste Entscheidung des Betreibers und schlägt sich im Datenschutz-
   * profil des Laufs nieder, damit ein Ergebnis nie strenger aussieht als es war.
   */
  zeroDataRetention?: boolean;
  maxOutputTokens: number;
  /** Denktiefe für Modelle mit Reasoning; Anbieter ohne Steuerung ignorieren sie. */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  timeoutMilliseconds?: number;
  /** Bricht den Aufruf ab, etwa wenn ein abgesicherter Zweitaufruf schneller war. */
  signal?: AbortSignal;
};

/** Das Zeitlimit eines Anbieteraufrufs, verbunden mit einem optionalen Abbruch. */
export function providerRequestSignal(
  request: Pick<StructuredModelRequest<unknown>, "signal">,
  timeoutMilliseconds: number,
) {
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  return request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
}

export type StructuredModelResponse<T> = {
  providerRequestId: string;
  requestedModelId: string;
  resolvedModelId: string;
  resolvedProvider?: string;
  output: T;
  rawOutput: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costMicrounits?: number;
};

/** Was ein Aufruf beim Anbieter verbraucht hat — auch wenn seine Antwort unbrauchbar war. */
export type ProviderUsage = Pick<
  StructuredModelResponse<unknown>,
  | "providerRequestId"
  | "inputTokens"
  | "cachedInputTokens"
  | "outputTokens"
  | "reasoningTokens"
  | "costMicrounits"
>;

export type ModelProviderErrorCode =
  | "INVALID_PROVIDER_ROUTE"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_OUTPUT_INCOMPLETE"
  | "PROVIDER_REFUSAL"
  | "MODEL_OUTPUT_INVALID"
  // Ab hier die Codes des Entscheidungsdienstes. Sie trennen die vier Fälle, die
  // eine Vertragsprüfung unterschiedlich behandeln muss: ein ungültiger Schlüssel
  // endet den Lauf, eine fehlerhafte Anfrage ist ein Programmfehler, eine Drosselung
  // wartet, ein Ausfall wiederholt.
  | "PROVIDER_CREDENTIAL_INVALID"
  | "PROVIDER_REQUEST_INVALID"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE";

export class ModelProviderError extends Error {
  constructor(
    public readonly code: ModelProviderErrorCode,
    public readonly retryable: boolean,
    /**
     * Kurze, gekürzte Begründung des Anbieters. Ohne sie bleibt ein
     * Konfigurationsfehler wie „Regional routing not enabled for this account"
     * als blosses `PROVIDER_HTTP_ERROR` unsichtbar, und der Lauf meldet nur
     * „fehlgeschlagen". Bewusst nur die Meldung des Anbieters, nie Anfrage,
     * Header oder Antwortkörper — dort stünden Policy-Inhalte und Schlüssel.
     */
    detail?: string,
    /**
     * Sekunden aus dem `Retry-After`-Kopf. Die Drosselung wartet damit genau so
     * lange, wie der Anbieter verlangt, statt zu raten.
     */
    public readonly retryAfterSeconds?: number,
  ) {
    super(detail ?? defaultProviderDetail[code]);
    this.name = "ModelProviderError";
    this.detail = detail ?? defaultProviderDetail[code];
  }

  /** Immer gesetzt: entweder die Meldung des Anbieters oder die Erklärung zum Code. */
  public readonly detail: string;

  /**
   * Gesetzt, wenn der Anbieter geantwortet und damit abgerechnet hat, die Antwort
   * aber verworfen wurde — etwa abgeschnitten oder schemawidrig. Ohne sie wies
   * ein Lauf nur die Kosten seiner erfolgreichen Aufrufe aus.
   */
  public usage?: ProviderUsage;
}

/**
 * Führt die Auswertung einer abgerechneten Antwort aus. Scheitert sie, trägt der
 * Fehler den Verbrauch weiter, damit der Aufruf mit seinen Kosten gespeichert wird.
 */
export function withBilledUsage<T>(usage: ProviderUsage, evaluate: () => T): T {
  try {
    return evaluate();
  } catch (error) {
    if (error instanceof ModelProviderError) error.usage ??= usage;
    throw error;
  }
}

/**
 * Jeder Providerfehler muss sich selbst erklären. Ohne diese Texte erschien etwa
 * eine unzulässige Basis-URL im Ergebnis nur als „ANALYSIS_RETRIES_EXHAUSTED" —
 * ein Code, der weder die Ursache nennt noch sagt, wo sie zu beheben ist.
 */
const defaultProviderDetail: Record<ModelProviderErrorCode, string> = {
  INVALID_PROVIDER_ROUTE:
    "Die Providerkonfiguration ist unvollständig oder die Basis-URL gehört nicht zum gewählten Anbieter.",
  PROVIDER_HTTP_ERROR: "Der Modellanbieter war nicht erreichbar.",
  PROVIDER_RESPONSE_TOO_LARGE: "Die Antwort des Modellanbieters war zu groß.",
  PROVIDER_RESPONSE_INVALID: "Die Antwort des Modellanbieters war nicht auswertbar.",
  PROVIDER_OUTPUT_INCOMPLETE:
    "Das Modell hat die Antwort abgeschnitten. Die Token-Obergrenze ist zu niedrig.",
  PROVIDER_REFUSAL: "Das Modell hat die Bearbeitung abgelehnt.",
  MODEL_OUTPUT_INVALID:
    "Das Modell hat kein gültiges Ergebnis nach dem vereinbarten Schema geliefert.",
  PROVIDER_CREDENTIAL_INVALID: "Der Anbieter hat den hinterlegten Schlüssel abgelehnt.",
  PROVIDER_REQUEST_INVALID: "Der Anbieter hat die Anfrage als ungültig abgelehnt.",
  PROVIDER_RATE_LIMITED: "Der Anbieter hat wegen zu vieler Anfragen gedrosselt.",
  PROVIDER_UNAVAILABLE: "Der Anbieter war vorübergehend nicht erreichbar.",
};

const maximumProviderDetailLength = 200;

/** Zieht die Fehlermeldung aus den bei allen Anbietern üblichen Formen. */
export function readProviderErrorDetail(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload.slice(0, maximumProviderDetailLength);
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  const candidate =
    (typeof error === "object" &&
    error &&
    typeof (error as Record<string, unknown>).message === "string"
      ? ((error as Record<string, unknown>).message as string)
      : undefined) ??
    (typeof error === "string" ? error : undefined) ??
    (typeof record.message === "string" ? record.message : undefined);
  return candidate?.trim().slice(0, maximumProviderDetailLength) || undefined;
}

/**
 * OpenRouter meldet einen Abbruch, der erst während der Generierung eintritt,
 * mit HTTP 200 und einem Fehlerobjekt statt einer Antwort. Ohne diese Prüfung
 * scheiterte der Lauf als „nicht auswertbar", obwohl der Anbieter den Grund
 * mitgeliefert hatte — und brach ab, obwohl ein zweiter Versuch gelungen wäre.
 */
export function throwIfProviderErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const error = (payload as Record<string, unknown>).error;
  if (!error) return;
  const status =
    typeof error === "object" ? Number((error as Record<string, unknown>).code) : Number.NaN;
  const knownStatus = Number.isInteger(status) && status >= 100 && status <= 599;
  const message = readProviderErrorDetail(payload);
  throw new ModelProviderError(
    "PROVIDER_HTTP_ERROR",
    knownStatus ? retryableProviderStatus(status) : true,
    `Abbruch während der Generierung${knownStatus ? ` (Fehler ${status})` : ""}${message ? `: ${message}` : ""}`,
  );
}

/**
 * Nennt, woran die Auswertung gescheitert ist. Standardmässig wiederholbar: eine
 * leere oder unvollständige Antwort ist fast immer ein Aussetzer des Anbieters.
 */
export function invalidProviderResponse(reason: string, retryable = true) {
  return new ModelProviderError(
    "PROVIDER_RESPONSE_INVALID",
    retryable,
    `${defaultProviderDetail.PROVIDER_RESPONSE_INVALID.replace(/\.$/u, "")}: ${reason}`,
  );
}

/**
 * Stellt dem Fehler voran, wo er entstand — Anforderung, Stufe, Versuch, Modell —
 * und hängt den Code an. Die Meldung „nicht auswertbar" allein liess offen, ob
 * Bewertung oder Verifikation, welches Modell und welche Anforderung betroffen war.
 */
export function withProviderErrorContext(error: unknown, context: string) {
  if (!(error instanceof ModelProviderError)) return error;
  const contextual = new ModelProviderError(
    error.code,
    error.retryable,
    `${context}: ${error.detail} [${error.code}]`,
  );
  contextual.usage = error.usage;
  return contextual;
}

export function assertStructuredRequest(request: { apiKey: string; maxOutputTokens: number }) {
  if (!request.apiKey.trim()) throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
}

export function retryableProviderStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function readProviderJson(response: Response) {
  if (!response.ok) {
    // Den Fehlerkörper noch lesen, bevor geworfen wird: er trägt die einzige
    // Auskunft darüber, warum der Anbieter abgelehnt hat.
    let detail: string | undefined;
    try {
      detail = readProviderErrorDetail(JSON.parse((await response.text()).slice(0, 4_000)));
    } catch {
      detail = undefined;
    }
    // OpenRouter reserviert Guthaben für laufende Anfragen. Laufen Anforderungen
    // parallel, lehnt es weitere mit 402 ab, bis die anderen fertig sind — ein
    // Wartefall, kein fehlendes Guthaben.
    const waitsForInFlightRequests = response.status === 402 && /in-flight/iu.test(detail ?? "");
    throw new ModelProviderError(
      "PROVIDER_HTTP_ERROR",
      waitsForInFlightRequests || retryableProviderStatus(response.status),
      detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > 2_000_000) {
    throw new ModelProviderError("PROVIDER_RESPONSE_TOO_LARGE", false);
  }
  let responseText: string;
  try {
    responseText = await response.text();
  } catch {
    throw new ModelProviderError(
      "PROVIDER_HTTP_ERROR",
      true,
      "Die Verbindung zum Modellanbieter brach beim Lesen der Antwort ab.",
    );
  }
  if (responseText.length > 2_000_000) {
    throw new ModelProviderError("PROVIDER_RESPONSE_TOO_LARGE", false);
  }
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    // Nur Länge und Inhaltstyp nennen, nie den Körper: dort stünden Policy-Zitate.
    throw invalidProviderResponse(
      responseText.trim()
        ? `kein gültiges JSON (HTTP ${response.status}, ${responseText.length} Zeichen, ${
            response.headers.get("content-type") ?? "ohne Inhaltstyp"
          })`
        : `leerer Antwortkörper (HTTP ${response.status})`,
    );
  }
}

export const providerRequestTimeoutMilliseconds = 180_000;

/**
 * Führt die Anbieteranfrage aus und erzwingt die Zeitgrenze zusätzlich über einen
 * eigenen Timer.
 *
 * `AbortSignal.timeout` allein reichte nicht: einzelne Aufrufe blieben 7 und 15
 * Minuten hängen, obwohl 120 Sekunden gesetzt waren — ein stehengebliebener
 * Lesevorgang löst das Abbruchsignal nicht zuverlässig aus. Ein hängender Aufruf
 * blockiert den Workflow-Schritt und verbrennt die Wiederholungen, ohne dass
 * jemand erfährt, worauf gewartet wird.
 */
export async function fetchProviderJson(
  url: URL,
  init: RequestInit,
  fetchImplementation: typeof fetch,
  timeoutMilliseconds: number = providerRequestTimeoutMilliseconds,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ModelProviderError(
            "PROVIDER_HTTP_ERROR",
            true,
            `Der Modellanbieter hat nach ${Math.round(timeoutMilliseconds / 1000)} Sekunden nicht geantwortet.`,
          ),
        ),
      timeoutMilliseconds,
    );
  });

  let response: Response;
  try {
    response = await Promise.race([fetchImplementation(url, init), deadline]);
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;
    throw new ModelProviderError(
      "PROVIDER_HTTP_ERROR",
      true,
      "Der Modellanbieter war nicht erreichbar.",
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { response, payload: await readProviderJson(response) };
}

export function parseStructuredOutput<T>(rawOutput: string, outputSchema: z.ZodType<T>): T {
  try {
    // Router ohne `response_format`-Zusage (Jev Router, D-036) umschließen JSON gelegentlich
    // mit einem Code-Fence; der Inhalt wird trotzdem streng gegen das Schema geprüft.
    const fenced = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/u.exec(rawOutput);
    return outputSchema.parse(JSON.parse(fenced ? fenced[1]! : rawOutput));
  } catch (error) {
    // Die verletzten Regeln benennen, statt sie zu verwerfen: der zweite Versuch
    // bekam bisher nur „schema validation failed" und scheiterte deshalb
    // zuverlässig ein zweites Mal an derselben Stelle. Die Meldungen stammen aus
    // dem eigenen Schema und enthalten keine Policy-Inhalte.
    throw new ModelProviderError("MODEL_OUTPUT_INVALID", false, describeSchemaIssues(error));
  }
}

export function describeSchemaIssues(error: unknown): string | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  const issues = error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .slice(0, 6);
  return issues.length ? issues.join("; ").slice(0, 400) : undefined;
}

export function dollarsToMicrounits(cost?: number) {
  return cost === undefined ? undefined : Math.round(cost * 1_000_000);
}
