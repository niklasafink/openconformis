"use client";

import { Check, LoaderCircle, LockKeyhole, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  labels: {
    preparing: string;
    parsing: string;
    mapping: string;
    checking: string;
    complete: string;
    startFailed: string;
    lockedTitle: string;
    lockedBody: string;
    email: string;
    magicLink: string;
    emailSent: string;
    magicLinkBrowserHint: string;
    magicLinkMode: string;
    passwordMode: string;
    password: string;
    signIn: string;
    signUp: string;
    switchToSignIn: string;
    switchToSignUp: string;
    authFailed: string;
    google: string;
    microsoft: string;
    or: string;
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
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [authMode, setAuthMode] = useState<"magic-link" | "password">("magic-link");
  const [passwordAction, setPasswordAction] = useState<"sign-in" | "sign-up">("sign-in");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState(Boolean(authCallbackError));
  const [authDialogOpen, setAuthDialogOpen] = useState(Boolean(authCallbackError));
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState(false);
  const [byokRequired, setByokRequired] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [credentialPending, setCredentialPending] = useState(false);
  const [credentialError, setCredentialError] = useState(false);
  const [privacyAttestationAccepted, setPrivacyAttestationAccepted] = useState(false);
  const startRequested = useRef(false);
  const steps = [labels.parsing, labels.mapping, labels.checking];

  function absoluteCallbackUrl() {
    return new URL(
      callbackUrl,
      process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin,
    ).toString();
  }

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
        const requiresOwnKey =
          response.status === 402 ||
          payload.code === "SPONSORED_RUNS_DISABLED" ||
          payload.code === "SPONSORED_ROUTE_NOT_CONFIGURED" ||
          payload.code === "SPONSORED_MODEL_NOT_ALLOWED";
        if (requiresOwnKey) {
          setByokRequired(true);
          return;
        }
        if (!response.ok || !payload.analysisId) throw new Error("ANALYSIS_START_FAILED");
        router.replace(`/${locale}/analyses/${payload.analysisId}`);
      })
      .catch(() => setStartError(true));
  }, [draftId, locale, router, session, step, steps.length]);

  async function sendMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAuthError(false);
    try {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: absoluteCallbackUrl(),
      });
      if (!result.error) setEmailSent(true);
      else setAuthError(true);
    } catch {
      setAuthError(true);
    } finally {
      setPending(false);
    }
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAuthError(false);
    try {
      const callbackURL = absoluteCallbackUrl();
      const result =
        passwordAction === "sign-in"
          ? await authClient.signIn.email({ email, password, callbackURL })
          : await authClient.signUp.email({
              email,
              password,
              name: email.split("@")[0] || email,
              callbackURL,
            });
      if (result.error) {
        setAuthError(true);
        return;
      }

      // Make the newly issued HttpOnly session cookie authoritative before
      // the protected analysis is claimed by this account.
      window.location.assign(callbackURL);
    } catch {
      setAuthError(true);
    } finally {
      setPending(false);
      setPassword("");
    }
  }

  async function signInSocial(provider: "google" | "microsoft") {
    setAuthError(false);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: absoluteCallbackUrl(),
      });
      if (result.error) setAuthError(true);
    } catch {
      setAuthError(true);
    }
  }

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

      {!session && authDialogOpen ? (
        <div
          className="preview-auth-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setAuthDialogOpen(false);
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
            <div className="preview-auth-modes" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "magic-link"}
                onClick={() => setAuthMode("magic-link")}
              >
                {labels.magicLinkMode}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "password"}
                onClick={() => setAuthMode("password")}
              >
                {labels.passwordMode}
              </button>
            </div>
            {authError ? <p className="preview-key-error">{labels.authFailed}</p> : null}
            {emailSent && authMode === "magic-link" ? (
              <div className="preview-email-sent">
                {labels.emailSent}
                <small>{labels.magicLinkBrowserHint}</small>
              </div>
            ) : authMode === "magic-link" ? (
              <form onSubmit={sendMagicLink}>
                <label htmlFor="preview-email">{labels.email}</label>
                <input
                  id="preview-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <button className="button button-primary" type="submit" disabled={pending}>
                  {labels.magicLink}
                </button>
              </form>
            ) : (
              <form onSubmit={submitPassword}>
                <label htmlFor="preview-password-email">{labels.email}</label>
                <input
                  id="preview-password-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <label htmlFor="preview-password">{labels.password}</label>
                <input
                  id="preview-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={passwordAction === "sign-in" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button className="button button-primary" type="submit" disabled={pending}>
                  {passwordAction === "sign-in" ? labels.signIn : labels.signUp}
                </button>
                <button
                  className="preview-auth-switch"
                  type="button"
                  onClick={() =>
                    setPasswordAction((current) => (current === "sign-in" ? "sign-up" : "sign-in"))
                  }
                >
                  {passwordAction === "sign-in" ? labels.switchToSignUp : labels.switchToSignIn}
                </button>
              </form>
            )}
            <div className="preview-auth-divider">
              <span>{labels.or}</span>
            </div>
            <div className="preview-social-actions">
              <button type="button" onClick={() => void signInSocial("google")}>
                {labels.google}
              </button>
              <button type="button" onClick={() => void signInSocial("microsoft")}>
                {labels.microsoft}
              </button>
            </div>
          </section>
        </div>
      ) : byokRequired ? (
        <div className="preview-auth-backdrop">
          <section className="preview-auth-card preview-byok-card" role="dialog" aria-modal="true">
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
      ) : session ? (
        <div className="preview-authenticated-notice" role="status">
          {startError ? labels.startFailed : labels.complete}
        </div>
      ) : null}
    </div>
  );
}
