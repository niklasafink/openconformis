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

/**
 * Gemeinsame Anmeldeform für die eigenständige Anmeldeseite und den Dialog im
 * Ergebnis-Vorschauscreen. Beide Flächen müssen dasselbe Verhalten zeigen —
 * getrennte Implementierungen sind genau die Art von Abweichung, die dazu führt,
 * dass ein Pfad repariert wird und der andere still kaputt bleibt.
 */
export function AuthForm({ callbackUrl, initialError = false, labels }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [mode, setMode] = useState<"magic-link" | "password">("magic-link");
  const [passwordAction, setPasswordAction] = useState<"sign-in" | "sign-up">("sign-in");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
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
    setError(false);
    try {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: absoluteCallbackUrl(),
      });
      if (result.error) setError(true);
      else setEmailSent(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(false);
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
        setError(true);
        return;
      }

      // Vollständige Navigation statt Client-Routing: die neu ausgestellte
      // HttpOnly-Session muss serverseitig autoritativ sein, bevor die
      // geschützte Zielseite gerendert wird.
      window.location.assign(callbackURL);
    } catch {
      setError(true);
    } finally {
      setPending(false);
      setPassword("");
    }
  }

  async function signInSocial(provider: "google" | "microsoft") {
    setError(false);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: absoluteCallbackUrl(),
      });
      if (result.error) setError(true);
    } catch {
      setError(true);
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

      {error ? (
        <p className="auth-error" role="alert">
          {labels.authFailed}
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
