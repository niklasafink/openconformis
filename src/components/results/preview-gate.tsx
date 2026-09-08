"use client";

import { Check, LoaderCircle, LockKeyhole, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthForm, type AuthFormLabels } from "@/components/auth/auth-form";
import { authClient } from "@/lib/auth-client";
import type { AiRouteProvider } from "@/domain/ai/provider";
import {
  AnalysisResultsWorkspace,
  type AnalysisResultLabels,
  type DocumentBlock,
  type ResultItem,
} from "@/components/results/analysis-results-workspace";

type PreviewGateProps = {
  callbackUrl: string;
  authCallbackError?: string;
  localAuthBypass?: boolean;
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
  };
  labels: AuthFormLabels & {
    preparing: string;
    parsing: string;
    mapping: string;
    checking: string;
    startFailed: string;
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
    unlockResult: string;
    close: string;
  };
};

type StartFailure = { message: string; signInRequired: boolean };

const animationStepMilliseconds = 650;

function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Die Vorschau zeigt Demo-Stati ohne echte Bewertung und bleibt deshalb
 * verschwommen. Wer angemeldet ist, verbindet hier seinen eigenen Schlüssel;
 * damit startet die echte Analyse und ersetzt die Vorschau.
 */
export function PreviewGate({
  callbackUrl,
  authCallbackError,
  localAuthBypass = false,
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
  const signedIn = localAuthBypass || Boolean(session);
  const [step, setStep] = useState(0);
  // Solange niemand den Dialog angefasst hat, entscheidet die Anmeldung: nach ihr
  // gibt es nur noch einen nächsten Schritt, den Schlüssel.
  const [dialog, setDialog] = useState<"open" | "closed" | undefined>(
    authCallbackError ? "open" : undefined,
  );
  const dialogOpen = dialog === "open" || (dialog === undefined && signedIn);
  const [apiKey, setApiKey] = useState("");
  const [credentialId, setCredentialId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<StartFailure | null>(null);
  const steps = [labels.parsing, labels.mapping, labels.checking];

  useEffect(() => {
    if (signedIn || step >= steps.length) return;
    const timer = window.setTimeout(
      () => setStep((current) => current + 1),
      animationStepMilliseconds,
    );
    return () => window.clearTimeout(timer);
  }, [signedIn, step, steps.length]);

  function closeDialog() {
    if (pending) return;
    setApiKey("");
    setDialog("closed");
  }

  async function connectCredentialAndStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      let connectedCredentialId = credentialId;
      if (!connectedCredentialId) {
        const credentialResponse = await postJson("/api/ai-credentials", {
          provider: selectedModel.routeProvider,
          purpose: "analysis",
          bindingId: draftId,
          requiredModelId: selectedModel.providerModelId,
          apiKey: apiKey.trim(),
        });
        const credential = (await credentialResponse.json()) as { credentialId?: string };
        if (!credentialResponse.ok || !credential.credentialId) {
          setFailure({
            message: labels.keyFailed,
            signInRequired: credentialResponse.status === 401,
          });
          return;
        }
        connectedCredentialId = credential.credentialId;
        setCredentialId(connectedCredentialId);
        setApiKey("");
      }

      const startResponse = await postJson("/api/analyses/start", {
        draftId,
        credentialId: connectedCredentialId,
      });
      const analysis = (await startResponse.json()) as {
        analysisId?: string;
        message?: string;
        code?: string;
      };
      if (!startResponse.ok || !analysis.analysisId) {
        if (analysis.code === "BYOK_CREDENTIAL_INVALID") {
          setCredentialId(undefined);
        }
        // Die Begründung des Servers hat Vorrang: sie benennt den konkreten
        // Zustand, der lokale Text kennt nur die Fallgruppe.
        setFailure({
          message: analysis.message ?? labels.startFailed,
          signInRequired: startResponse.status === 401,
        });
        return;
      }
      router.replace(`/${locale}/analyses/${analysis.analysisId}`);
    } catch {
      setFailure({ message: labels.startFailed, signInRequired: false });
    } finally {
      setApiKey("");
      setPending(false);
    }
  }

  if (!signedIn && step < steps.length) {
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
          unlockLabel: signedIn ? labels.byokTitle : labels.unlockResult,
          onUnlock: () => setDialog("open"),
        }}
      />

      {dialogOpen ? (
        <div
          className="preview-auth-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            className={signedIn ? "preview-auth-card preview-byok-card" : "preview-auth-card"}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-dialog-title"
          >
            <button
              type="button"
              className="preview-auth-close"
              aria-label={labels.close}
              onClick={closeDialog}
              disabled={pending}
            >
              <X size={18} aria-hidden="true" />
            </button>
            {signedIn ? (
              <>
                <h1 id="preview-dialog-title">{labels.byokTitle}</h1>
                <p>{labels.byokBody}</p>
                <dl className="preview-byok-model">
                  <div>
                    <dt>{labels.selectedModel}</dt>
                    <dd>{selectedModel.providerModelId}</dd>
                  </div>
                </dl>
                <form onSubmit={connectCredentialAndStart}>
                  {!credentialId ? (
                    <>
                      <label htmlFor="preview-api-key">
                        {selectedModel.routeProviderLabel} API-Key
                      </label>
                      <input
                        id="preview-api-key"
                        type="password"
                        required
                        minLength={8}
                        maxLength={20_000}
                        autoComplete="off"
                        disabled={pending}
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </>
                  ) : null}
                  {failure ? (
                    <p className="preview-key-error" role="alert">
                      {failure.message}
                      {failure.signInRequired ? (
                        <>
                          {" "}
                          <a href={`/${locale}/sign-in?next=${encodeURIComponent(callbackUrl)}`}>
                            {labels.goToSignIn}
                          </a>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  <div className="preview-key-actions">
                    <a href={selectedModel.credentialHelpUrl} target="_blank" rel="noreferrer">
                      {labels.keyLink}
                    </a>
                    <button className="button button-primary" type="submit" disabled={pending}>
                      {pending ? labels.connecting : labels.connect}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <span className="preview-lock">
                  <LockKeyhole size={18} />
                </span>
                <h1 id="preview-dialog-title">{labels.lockedTitle}</h1>
                <p>{labels.lockedBody}</p>
                <AuthForm
                  callbackUrl={callbackUrl}
                  initialError={Boolean(authCallbackError)}
                  labels={labels}
                />
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
