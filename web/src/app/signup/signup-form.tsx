"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-error";
import { ApiError, apiClient } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";

// Key for stashing the org-info portion of signup so /onboarding can
// pre-fill it. The new /api/auth/signup endpoint only accepts identity
// fields (email, password, fullName); org details belong to onboarding.
// Storing them in sessionStorage preserves the existing UX without
// stuffing org data into auth.users metadata.
const PENDING_ONBOARDING_KEY = "avi.pendingOnboarding";

export function SignupForm() {
  const t = useT();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // Field-tied, screen-reader-announced error (alongside the toast).
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    orgName: "",
    orgCode: "",
    fullName: "",
    email: "",
    password: "",
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (error) setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.auth.signUp({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
      });

      // Stash org details locally so /onboarding can pre-fill them.
      // Cleared by onboarding once the org is created.
      try {
        sessionStorage.setItem(
          PENDING_ONBOARDING_KEY,
          JSON.stringify({
            orgName: form.orgName,
            orgCode: form.orgCode,
          }),
        );
      } catch {
        // sessionStorage can throw in some private-mode browsers — fine,
        // user will retype on /onboarding.
      }

      if (result.needsEmailConfirmation) {
        toast.success(t("auth.signup.confirmToast"));
        router.push(`/login?pending=${encodeURIComponent(form.email)}`);
      } else {
        toast.success(t("auth.signup.createdToast"));
        router.push("/onboarding");
        router.refresh();
      }
    } catch (err) {
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="orgName">{t("auth.signup.orgName")}</Label>
          <Input
            id="orgName"
            value={form.orgName}
            onChange={(e) => update("orgName", e.target.value)}
            placeholder={t("auth.signup.orgNamePlaceholder")}
            autoComplete="organization"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="orgCode">{t("auth.signup.orgCode")}</Label>
          <Input
            id="orgCode"
            value={form.orgCode}
            onChange={(e) => update("orgCode", e.target.value.toUpperCase())}
            placeholder="AVI"
            pattern="[A-Z0-9-]{3,20}"
            dir="ltr"
            className="text-start uppercase"
            autoComplete="off"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fullName">{t("common.fullName")}</Label>
        <Input
          id="fullName"
          value={form.fullName}
          onChange={(e) => update("fullName", e.target.value)}
          placeholder={t("auth.signup.fullNamePlaceholder")}
          autoComplete="name"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t("common.email")}</Label>
        <Input
          id="email"
          type="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="avi@example.com"
          dir="ltr"
          className="text-start"
          autoComplete="email"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "signup-error" : undefined}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <Input
          id="password"
          type="password"
          value={form.password}
          onChange={(e) => update("password", e.target.value)}
          minLength={8}
          autoComplete="new-password"
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? "signup-password-hint signup-error" : "signup-password-hint"
          }
          required
        />
        <p id="signup-password-hint" className="text-xs text-muted-foreground">
          {t("auth.passwordHint")}
        </p>
      </div>

      <FormError id="signup-error" message={error} />
      <Button type="submit" className="w-full h-11" disabled={loading}>
        {loading ? t("auth.signup.submitting") : t("auth.signup.submit")}
      </Button>
    </form>
  );
}
