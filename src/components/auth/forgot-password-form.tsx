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

type ForgotPasswordFormProps = Readonly<{ locale: AppLocale }>;

export function ForgotPasswordForm({ locale }: ForgotPasswordFormProps) {
  const t = useTranslations("ForgotPassword");
  const tAuth = useTranslations("Auth");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const redirectTo = new URL(
        `/${locale}/reset-password`,
        process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin,
      ).toString();
      const result = await authClient.requestPasswordReset({ email, redirectTo });
      if (result.error) {
        const classified = classifyAuthFailure(result.error);
        setError(classified === "tooManyAttempts" ? tAuth("tooManyAttempts") : tAuth("authFailed"));
        return;
      }
      // Immer dieselbe Bestätigung, unabhängig davon, ob ein Konto existiert —
      // sonst ließe sich über diese Fläche erraten, welche Adressen registriert sind.
      setSent(true);
    } catch {
      setError(tAuth("authFailed"));
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-foreground" role="status">
          {t("sent")}
        </p>
        <Link
          href="/sign-in"
          locale={locale}
          className="text-sm font-medium text-foreground hover:underline"
        >
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <p className="mb-6 text-sm text-muted-foreground">{t("body")}</p>

      {error ? (
        <p
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-1.5">
          <Label htmlFor="forgot-password-email">{tAuth("email")}</Label>
          <Input
            id="forgot-password-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending} className="mt-1 w-full rounded-full">
          {t("submit")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link
          href="/sign-in"
          locale={locale}
          className="font-medium text-foreground hover:underline"
        >
          {t("backToSignIn")}
        </Link>
      </p>
    </>
  );
}
