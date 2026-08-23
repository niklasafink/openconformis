"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export type AuthFormLabels = {
  email: string;
  magicLink: string;
  magicLinkResend: string;
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
  accountExists: string;
  invalidCredentials: string;
  passwordTooShort: string;
  tooManyAttempts: string;
  google: string;
  microsoft: string;
  or: string;
};

export type AuthFormProps = {
  /** Absolutes oder relatives Ziel, auf das der Provider nach Erfolg zurückspringt. */
  callbackUrl: string;
  initialError?: boolean;
  labels: AuthFormLabels;
};

type AuthFailure =
  "generic" | "accountExists" | "invalidCredentials" | "passwordTooShort" | "tooManyAttempts";

/**
 * Übersetzt den Fehler des Anbieters in einen Fall, den der Nutzer selbst
 * auflösen kann. Ohne diese Zuordnung sah jemand, der sich mit einer bereits
 * registrierten Adresse anmelden wollte, nur „Die Anmeldung konnte nicht
 * abgeschlossen werden." — ohne den einen Hinweis, der weitergeholfen hätte.
 *
 * Der Client wirft `AuthApiError` und führt dort nur einen groben `code`
 * ("validation_failed"); der genaue Grund steht ausschließlich in der Meldung.
 * Deshalb wird beides ausgewertet. Die Meldungen sind englische Anbietertexte —
 * `classifyAuthFailure` ist exportiert, damit diese Abhängigkeit getestet ist und
 * ein Formulierungswechsel beim Anbieter nicht still zur Sackgasse zurückführt.
 */
export function classifyAuthFailure(error: unknown): AuthFailure {
  const shape = (error ?? {}) as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof shape.code === "string" ? shape.code.toUpperCase() : "";
  const message = typeof shape.message === "string" ? shape.message.toLowerCase() : "";
  const status = typeof shape.status === "number" ? shape.status : undefined;

  if (code.includes("USER_ALREADY_EXISTS") || message.includes("already exists")) {
    return "accountExists";
  }
  if (
    code.includes("INVALID_EMAIL_OR_PASSWORD") ||
    message.includes("invalid email or password") ||
    message.includes("invalid password")
  ) {
    return "invalidCredentials";
  }
  if (
    message.includes("password") &&
    (message.includes("too short") || message.includes("at least") || message.includes("too long"))
  ) {
    return "passwordTooShort";
  }
  if (status === 429 || message.includes("too many")) return "tooManyAttempts";
  if (status === 401) return "invalidCredentials";
  return "generic";
}

export function AuthForm({ callbackUrl, initialError = false, labels }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [mode, setMode] = useState<"magic-link" | "password">("magic-link");
  const [passwordAction, setPasswordAction] = useState<"sign-in" | "sign-up">("sign-in");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<AuthFailure | null>(initialError ? "generic" : null);
  const [pending, setPending] = useState(false);

  function absoluteCallbackUrl() {
    return new URL(
      callbackUrl,
      process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin,
    ).toString();
  }

  async function sendMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(null);
    try {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: absoluteCallbackUrl(),
      });
      if (result.error) setFailure(classifyAuthFailure(result.error));
      else setEmailSent(true);
    } catch (thrown) {
      setFailure(classifyAuthFailure(thrown));
    } finally {
      setPending(false);
    }
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailure(null);
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
        const classified = classifyAuthFailure(result.error);
        setFailure(classified);
        // Wer bereits ein Konto hat, will sich anmelden, nicht registrieren.
        // Den Umschalter selbst zu finden ist eine unnötige Hürde.
        if (classified === "accountExists") setPasswordAction("sign-in");
        return;
      }

      // Vollständige Navigation statt Client-Routing: die neu ausgestellte
      // HttpOnly-Session muss serverseitig autoritativ sein, bevor die
      // geschützte Zielseite gerendert wird.
      window.location.assign(callbackURL);
    } catch (thrown) {
      const classified = classifyAuthFailure(thrown);
      setFailure(classified);
      if (classified === "accountExists") setPasswordAction("sign-in");
    } finally {
      setPending(false);
      setPassword("");
    }
  }

  async function signInSocial(provider: "google" | "microsoft") {
    setFailure(null);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: absoluteCallbackUrl(),
      });
      if (result.error) setFailure(classifyAuthFailure(result.error));
    } catch (thrown) {
      setFailure(classifyAuthFailure(thrown));
    }
  }

  return (
    <>
      <div className="auth-modes" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "magic-link"}
          onClick={() => setMode("magic-link")}
        >
          {labels.magicLinkMode}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          onClick={() => setMode("password")}
        >
          {labels.passwordMode}
        </button>
      </div>

      {failure ? (
        <p className="auth-error" role="alert">
          {failure === "accountExists"
            ? labels.accountExists
            : failure === "invalidCredentials"
              ? labels.invalidCredentials
              : failure === "passwordTooShort"
                ? labels.passwordTooShort
                : failure === "tooManyAttempts"
                  ? labels.tooManyAttempts
                  : labels.authFailed}
        </p>
      ) : null}

      {emailSent && mode === "magic-link" ? (
        <div className="auth-email-sent" role="status">
          {labels.emailSent}
          <small>{labels.magicLinkBrowserHint}</small>
          <button type="button" className="auth-switch" onClick={() => setEmailSent(false)}>
            {labels.magicLinkResend}
          </button>
        </div>
      ) : mode === "magic-link" ? (
        <form onSubmit={sendMagicLink}>
          <label htmlFor="auth-email">{labels.email}</label>
          <input
            id="auth-email"
            name="email"
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
          <label htmlFor="auth-password-email">{labels.email}</label>
          <input
            id="auth-password-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="auth-password">{labels.password}</label>
          <input
            id="auth-password"
            name="password"
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
            className="auth-switch"
            type="button"
            onClick={() =>
              setPasswordAction((current) => (current === "sign-in" ? "sign-up" : "sign-in"))
            }
          >
            {passwordAction === "sign-in" ? labels.switchToSignUp : labels.switchToSignIn}
          </button>
        </form>
      )}

      <div className="auth-divider">
        <span>{labels.or}</span>
      </div>
      <div className="auth-social-actions">
        <button type="button" onClick={() => void signInSocial("google")}>
          {labels.google}
        </button>
        <button type="button" onClick={() => void signInSocial("microsoft")}>
          {labels.microsoft}
        </button>
      </div>
    </>
  );
}
