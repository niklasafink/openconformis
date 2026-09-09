"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { classifyAuthFailure } from "@/components/auth/classify-auth-failure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { authClient } from "@/lib/auth-client";

export type AuthFormMode = "sign-in" | "sign-up";

export type AuthFormProps = {
  mode: AuthFormMode;
  locale: AppLocale;
  /** Absolutes oder relatives Ziel, auf das der Provider nach Erfolg zurückspringt. */
  callbackUrl: string;
  initialError?: boolean;
  /**
   * Ziel für den Umschalter zwischen Anmeldung und Registrierung. Gesetzt auf
   * den eigenständigen Seiten, die den jeweils anderen Modus über eine eigene
   * URL abbilden. Fehlt er (eingebettete Vorschau-Anmeldung), wechselt der
   * Umschalter stattdessen den lokalen Zustand, ohne die Seite zu verlassen.
   */
  switchHref?: string;
};

type LocalFailure = ReturnType<typeof classifyAuthFailure> | "passwordMismatch";

export function AuthForm({
  mode,
  locale,
  callbackUrl,
  initialError = false,
  switchHref,
}: AuthFormProps) {
  const t = useTranslations("Auth");
  const [currentMode, setCurrentMode] = useState<AuthFormMode>(mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [failure, setFailure] = useState<LocalFailure | null>(initialError ? "generic" : null);
  const [pending, setPending] = useState(false);

  function absoluteCallbackUrl() {
    return new URL(
      callbackUrl,
      process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin,
    ).toString();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (currentMode === "sign-up" && password !== confirmPassword) {
      setFailure("passwordMismatch");
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const callbackURL = absoluteCallbackUrl();
      const result =
        currentMode === "sign-in"
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
        if (classified === "accountExists") setCurrentMode("sign-in");
        return;
      }

      // Vollständige Navigation statt Client-Routing: die neu ausgestellte
      // HttpOnly-Session muss serverseitig autoritativ sein, bevor die
      // geschützte Zielseite gerendert wird.
      window.location.assign(callbackURL);
    } catch (thrown) {
      const classified = classifyAuthFailure(thrown);
      setFailure(classified);
      if (classified === "accountExists") setCurrentMode("sign-in");
    } finally {
      setPending(false);
      setPassword("");
      setConfirmPassword("");
    }
  }

  const failureMessage =
    failure === "accountExists"
      ? t("accountExists")
      : failure === "invalidCredentials"
        ? t("invalidCredentials")
        : failure === "passwordTooShort"
          ? t("passwordTooShort")
          : failure === "tooManyAttempts"
            ? t("tooManyAttempts")
            : failure === "passwordMismatch"
              ? t("passwordMismatch")
              : failure === "generic"
                ? t("authFailed")
                : null;

  return (
    <>
      {failureMessage ? (
        <p
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {failureMessage}
        </p>
      ) : null}

      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-1.5">
          <Label htmlFor="auth-email">{t("email")}</Label>
          <Input
            id="auth-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="auth-password">{t("password")}</Label>
            {currentMode === "sign-in" ? (
              <Link
                href="/forgot-password"
                locale={locale}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {t("forgotPassword")}
              </Link>
            ) : null}
          </div>
          <Input
            id="auth-password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={currentMode === "sign-in" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {currentMode === "sign-up" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="auth-confirm-password">{t("confirmPassword")}</Label>
            <Input
              id="auth-confirm-password"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
        ) : null}

        {currentMode === "sign-up" ? (
          <p className="text-sm text-muted-foreground">
            {t.rich("termsAgreement", {
              terms: (chunks) => (
                <Link
                  href="/terms"
                  locale={locale}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link
                  href="/privacy"
                  locale={locale}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="mt-1 w-full rounded-full">
          {currentMode === "sign-in" ? t("signIn") : t("signUp")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {currentMode === "sign-in" ? t("dontHaveAccount") : t("alreadyHaveAccount")}{" "}
        {switchHref ? (
          <Link
            href={switchHref}
            locale={locale}
            className="font-medium text-foreground hover:underline"
          >
            {currentMode === "sign-in" ? t("signUpLink") : t("signInLink")}
          </Link>
        ) : (
          <button
            type="button"
            className="font-medium text-foreground hover:underline"
            onClick={() =>
              setCurrentMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"))
            }
          >
            {currentMode === "sign-in" ? t("signUpLink") : t("signInLink")}
          </button>
        )}
      </p>
    </>
  );
}
