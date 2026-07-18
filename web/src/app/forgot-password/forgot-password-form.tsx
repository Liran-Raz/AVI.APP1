"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-error";
import { ApiError, apiClient } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";

export function ForgotPasswordForm() {
  const t = useT();
  // Anti-leak by design: regardless of whether the email belongs to a real
  // user (or whether the provider call succeeded server-side), we show the
  // exact same generic message. The server is also coded to always return
  // success for the same reason.
  const genericSuccess = t("auth.forgot.genericSuccess");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Field-tied, screen-reader-announced error (alongside the toast).
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiClient.auth.requestPasswordReset({ email });
      toast.success(genericSuccess);
      setSubmitted(true);
    } catch (err) {
      // The server is designed to swallow everything, so reaching this
      // branch usually means a validation error (e.g. malformed email)
      // or a transport/network failure — not "email unknown".
      if (err instanceof ApiError) {
        setError(err.message);
        toast.error(err.message);
      } else {
        setError(t("common.unexpectedErrorRetry"));
        toast.error(t("common.unexpectedErrorRetry"));
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-3 text-sm text-center">
        <div
          role="status"
          className="rounded-md border border-primary/30 bg-primary/5 p-4"
        >
          📧 {genericSuccess}
        </div>
        <p className="text-muted-foreground text-xs">
          {t("auth.forgot.checkSpam")}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">{t("common.email")}</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          placeholder="name@example.com"
          dir="ltr"
          className="text-start"
          autoComplete="email"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "forgot-error" : undefined}
          required
        />
      </div>
      <FormError id="forgot-error" message={error} />
      <Button type="submit" className="w-full h-11" disabled={loading}>
        {loading ? t("auth.sending") : t("auth.forgot.submit")}
      </Button>
    </form>
  );
}
