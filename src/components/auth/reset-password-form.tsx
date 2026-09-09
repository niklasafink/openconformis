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

type ResetPasswordFormProps = Readonly<{ locale: AppLocale; token: string }>;

export function ResetPasswordForm({ locale, token }: ResetPasswordFormProps) {
  const t = useTranslations("ResetPassword");
  const tAuth = useTranslations("Auth");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError(tAuth("passwordMismatch"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) {
        const classified = classifyAuthFailure(result.error);
        setError(classified === "passwordTooShort" ? tAuth("passwordTooShort") : t("invalidToken"));
        return;
      }
      setDone(true);
    } catch {
      setError(tAuth("authFailed"));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-foreground" role="status">
          {t("success")}
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
          <Label htmlFor="reset-new-password">{t("newPassword")}</Label>
          <Input
            id="reset-new-password"
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reset-confirm-password">{t("confirmPassword")}</Label>
          <Input
            id="reset-confirm-password"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending} className="mt-1 w-full rounded-full">
          {t("submit")}
        </Button>
      </form>
    </>
  );
}
