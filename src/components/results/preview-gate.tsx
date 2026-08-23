"use client";

import { Check, LoaderCircle, LockKeyhole, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthForm, type AuthFormLabels } from "@/components/auth/auth-form";
import { authClient } from "@/lib/auth-client";
import type { AiRouteProvider } from "@/domain/ai/provider";
import {
  AnalysisResultsWorkspace,
  type AnalysisResultLabels,
  type DocumentBlock,
  type ResultItem,
} from "@/components/results/analysis-results-workspace";

type StartFailure = "authentication" | "verification" | "generic";

type PreviewGateProps = {
  callbackUrl: string;
  authCallbackError?: string;
  draftId: string;
  locale: string;
  frameworkSlug: string;
  policyName: string;
  organizationContext: string;
  previewItems: ResultItem[];
  previewDocumentBlocks: DocumentBlock[];
  resultLabels: AnalysisResultLabels;
  selectedModel: {
    providerModelId: string;
    routeProvider: AiRouteProvider;
    routeProviderLabel: string;
    credentialHelpUrl: string;
    privacyAttestationRequired: boolean;
  };
  labels: AuthFormLabels & {
    preparing: string;
    parsing: string;
    mapping: string;
    checking: string;
    complete: string;
    starting: string;
    startFailed: string;
    startFailedAuthentication: string;
    startFailedVerification: string;
    startFailedGeneric: string;
    retry: string;
    goToSignIn: string;
    lockedTitle: string;
    lockedBody: string;
    byokTitle: string;
    byokBody: string;
    selectedModel: string;
    connect: string;
    connecting: string;
    keyLink: string;
    keyFailed: string;
    privacyAttestation: string;
    unlockResult: string;
    close: string;
  };
};

const animationStepMilliseconds = 650;

export function PreviewGate({
  callbackUrl,
  authCallbackError,
  draftId,
  locale,
  frameworkSlug,
  policyName,
  organizationContext,
  previewItems,
  previewDocumentBlocks,
  resultLabels,
  selectedModel,
  labels,
}: PreviewGateProps) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [step, setStep] = useState(0);
  const [authDialogOpen, setAuthDialogOpen] = useState(Boolean(authCallbackError));
  const [startFailure, setStartFailure] = useState<StartFailure | null>(null);
  const [byokRequired, setByokRequired] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [credentialPending, setCredentialPending] = useState(false);
  const [credentialError, setCredentialError] = useState(false);
  const [privacyAttestationAccepted, setPrivacyAttestationAccepted] = useState(false);
  const startRequested = useRef(false);
  const steps = [labels.parsing, labels.mapping, labels.checking];

  useEffect(() => {
    if (step >= steps.length) return;
    const timer = window.setTimeout(
      () => setStep((current) => current + 1),
      animationStepMilliseconds,
    );
    return () => window.clearTimeout(timer);
  }, [step, steps.length]);

  useEffect(() => {
    if (!session || step < steps.length || startRequested.current) return;
    startRequested.current = true;

    void fetch("/api/analyses/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { analysisId?: string; code?: string };

        // Fehlendes Sponsoring ist kein Fehler, sondern der reguläre Weg in den
        // eigenen Modellzugang.
        if (
          response.status === 402 ||
          payload.code === "SPONSORED_RUNS_DISABLED" ||
          payload.code === "SPONSORED_ROUTE_NOT_CONFIGURED" ||
          payload.code === "SPONSORED_MODEL_NOT_ALLOWED"
        ) {
          setByokRequired(true);
          return;
        }

        // Diese Fälle sind für den Nutzer auflösbar — er muss aber erfahren, was
        // fehlt, statt eine generische Fehlermeldung zu sehen.
        if (response.status === 401 || payload.code === "AUTHENTICATION_REQUIRED") {
          setStartFailure("authentication");
          return;
        }
        if (response.status === 403 || payload.code === "VERIFIED_EMAIL_REQUIRED") {
          setStartFailure("verification");
          return;
        }

        if (!response.ok || !payload.analysisId) throw new Error("ANALYSIS_START_FAILED");
        router.replace(`/${locale}/analyses/${payload.analysisId}`);
      })
      .catch(() => setStartFailure("generic"));
  }, [draftId, locale, router, session, step, steps.length]);

  async function connectCredentialAndStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCredentialPending(true);
    setCredentialError(false);
    try {
      const credentialResponse = await fetch("/api/ai-credentials", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: selectedModel.routeProvider,
          purpose: "analysis",
          bindingId: draftId,
          requiredModelId: selectedModel.providerModelId,
          apiKey,
          privacyAttestationAccepted,
        }),
      });
      const credential = (await credentialResponse.json()) as { credentialId?: string };
      setApiKey("");
      if (!credentialResponse.ok || !credential.credentialId) {
        throw new Error("CREDENTIAL_CONNECTION_FAILED");
      }

      const startResponse = await fetch("/api/analyses/start/byok", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId, credentialId: credential.credentialId }),
      });
      const analysis = (await startResponse.json()) as { analysisId?: string };
      if (!startResponse.ok || !analysis.analysisId) throw new Error("BYOK_START_FAILED");
      router.replace(`/${locale}/analyses/${analysis.analysisId}`);
    } catch {
      setCredentialError(true);
    } finally {
      setApiKey("");
      setCredentialPending(false);
    }
  }

  function retryStart() {
    startRequested.current = false;
    setStartFailure(null);
    router.refresh();
  }

  if (step < steps.length) {
    return (
      <div className="preview-progress" role="status" aria-live="polite">
        <LoaderCircle className="preview-spinner" size={24} aria-hidden="true" />
        <h1>{labels.preparing}</h1>
        <ol>
          {steps.map((label, index) => (
            <li
              key={label}
              data-complete={index < step || undefined}
              data-active={index === step || undefined}
            >
              <span>{index < step ? <Check size={14} /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // Nach der Anmeldung wird die Vorschau nicht freigeschaltet, sondern ersetzt.
  // Die Vorschauwerte sind Demo-Stati ohne echte Bewertung — sie unverschwommen
  // zu zeigen, ließe erfundene Ergebnisse wie geprüfte aussehen.
  if (session) {
    return (
      <div className="preview-result-layout">
        {byokRequired ? (
          <div className="preview-auth-backdrop">
            <section
              className="preview-auth-card preview-byok-card"
              role="dialog"
              aria-modal="true"
            >
              <h1>{labels.byokTitle}</h1>
              <p>{labels.byokBody}</p>
              <dl className="preview-byok-model">
                <div>
                  <dt>{labels.selectedModel}</dt>
                  <dd>{selectedModel.providerModelId}</dd>
                </div>
              </dl>
              <form onSubmit={connectCredentialAndStart}>
                <label htmlFor="preview-api-key">{selectedModel.routeProviderLabel} API-Key</label>
                <input
                  id="preview-api-key"
                  type="password"
                  required
                  minLength={8}
                  maxLength={20_000}
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                {credentialError ? <p className="preview-key-error">{labels.keyFailed}</p> : null}
                {selectedModel.privacyAttestationRequired ? (
                  <label className="preview-privacy-attestation">
                    <input
                      type="checkbox"
                      required
                      checked={privacyAttestationAccepted}
                      onChange={(event) => setPrivacyAttestationAccepted(event.target.checked)}
                    />
                    <span>{labels.privacyAttestation}</span>
                  </label>
                ) : null}
                <div className="preview-key-actions">
                  <a href={selectedModel.credentialHelpUrl} target="_blank" rel="noreferrer">
                    {labels.keyLink}
                  </a>
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={credentialPending}
                  >
                    {credentialPending ? labels.connecting : labels.connect}
                  </button>
                </div>
              </form>
            </section>
          </div>
        ) : startFailure ? (
          <section className="preview-start-state preview-start-failed" role="alert">
            <h1>{labels.startFailed}</h1>
            <p>
              {startFailure === "authentication"
                ? labels.startFailedAuthentication
                : startFailure === "verification"
                  ? labels.startFailedVerification
                  : labels.startFailedGeneric}
            </p>
            <div className="preview-start-actions">
              {startFailure === "authentication" ? (
                <a
                  className="button button-primary"
                  href={`/${locale}/sign-in?next=${encodeURIComponent(callbackUrl)}`}
                >
                  {labels.goToSignIn}
                </a>
              ) : (
                <button className="button button-primary" type="button" onClick={retryStart}>
                  {labels.retry}
                </button>
              )}
            </div>
          </section>
        ) : (
          <section className="preview-start-state" role="status" aria-live="polite">
            <LoaderCircle className="preview-spinner" size={24} aria-hidden="true" />
            <h1>{labels.starting}</h1>
            <p>{labels.complete}</p>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="preview-result-layout">
      <AnalysisResultsWorkspace
        analysisId="preview"
        canConfirm={false}
        canOverride={false}
        frameworkSlug={frameworkSlug}
        policyName={policyName}
        organizationContext={organizationContext}
        items={previewItems}
        labels={resultLabels}
        lockedPreview={{
          documentBlocks: previewDocumentBlocks,
          unlockLabel: labels.unlockResult,
          onUnlock: () => setAuthDialogOpen(true),
        }}
      />

      {authDialogOpen ? (
        <div
          className="preview-auth-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAuthDialogOpen(false);
          }}
        >
          <section
            className="preview-auth-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-auth-title"
          >
            <button
              type="button"
              className="preview-auth-close"
              aria-label={labels.close}
              onClick={() => setAuthDialogOpen(false)}
            >
              <X size={18} aria-hidden="true" />
            </button>
            <span className="preview-lock">
              <LockKeyhole size={18} />
            </span>
            <h1 id="preview-auth-title">{labels.lockedTitle}</h1>
            <p>{labels.lockedBody}</p>
            <AuthForm
              callbackUrl={callbackUrl}
              initialError={Boolean(authCallbackError)}
              labels={labels}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
