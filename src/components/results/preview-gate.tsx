"use client";

import { Check, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import type { AiRouteProvider } from "@/domain/ai/provider";

type PreviewGateProps = {
  callbackUrl: string;
  draftId: string;
  locale: string;
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
  };
};

const animationStepMilliseconds = 650;

export function PreviewGate({
  callbackUrl,
  draftId,
  locale,
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
  const [authError, setAuthError] = useState(false);
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState(false);
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
        const payload = (await response.json()) as { analysisId?: string };
        if (response.status === 402) {
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
    const result = await authClient.signIn.magicLink({ email, callbackURL: callbackUrl });
    setPending(false);
    if (!result.error) setEmailSent(true);
    else setAuthError(true);
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAuthError(false);
    const result =
      passwordAction === "sign-in"
        ? await authClient.signIn.email({ email, password, callbackURL: callbackUrl })
        : await authClient.signUp.email({
            email,
            password,
            name: email.split("@")[0] || email,
            callbackURL: callbackUrl,
          });
    setPending(false);
    setPassword("");
    if (result.error) setAuthError(true);
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
      <div className="preview-result" aria-hidden="true" data-locked="true">
        <div className="preview-status-strip">
          <span>
            <strong>10</strong> geprüft
          </span>
          <span>
            <strong>3</strong> erfüllt
          </span>
          <span>
            <strong>4</strong> teilweise erfüllt
          </span>
          <span>
            <strong>2</strong> nicht erfüllt
          </span>
          <span>
            <strong>1</strong> nicht einschlägig
          </span>
        </div>
        <div className="preview-columns">
          <div>
            <strong>Art. 5 Abs. 2 DORA</strong>
            <p>Governance- und Kontrollrahmen</p>
          </div>
          <div>
            <strong>Governance- und Kontrollrahmen</strong>
            <p>Die Richtlinie beschreibt Zuständigkeiten, lässt jedoch einzelne Nachweise offen.</p>
          </div>
          <div>
            <strong>Beispiel-IKT-Sicherheitsrichtlinie.docx</strong>
            <p>Dokumentenansicht mit verknüpften Belegstellen</p>
          </div>
        </div>
      </div>

      {!session ? (
        <section className="preview-auth-card">
          <span className="preview-lock">
            <LockKeyhole size={18} />
          </span>
          <h1>{labels.lockedTitle}</h1>
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
            <div className="preview-email-sent">{labels.emailSent}</div>
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
            <button
              type="button"
              onClick={() =>
                void authClient.signIn.social({ provider: "google", callbackURL: callbackUrl })
              }
            >
              {labels.google}
            </button>
            <button
              type="button"
              onClick={() =>
                void authClient.signIn.social({ provider: "microsoft", callbackURL: callbackUrl })
              }
            >
              {labels.microsoft}
            </button>
          </div>
        </section>
      ) : byokRequired ? (
        <section className="preview-auth-card preview-byok-card">
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
              <button className="button button-primary" type="submit" disabled={credentialPending}>
                {credentialPending ? labels.connecting : labels.connect}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <div className="preview-authenticated-notice" role="status">
          {startError ? labels.startFailed : labels.complete}
        </div>
      )}
    </div>
  );
}
