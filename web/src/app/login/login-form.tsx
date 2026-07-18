"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ApiError, apiClient } from "@/lib/api-client";
import { isNativeApp } from "@/lib/native";
import { useT } from "@/i18n/locale-provider";

// NOTE: this client component no longer imports anything from
// @supabase/* or @/lib/supabase/*. All auth flows — including Google
// OAuth start — go through /api/* and the AuthAdapter on the server.

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/tasks";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await apiClient.auth.signIn({ email, password });
      if (result.needsMfa) {
        // Password OK but the account has 2FA — the session is aal1 and
        // every data route rejects it until the TOTP challenge passes.
        router.push(`/mfa?next=${encodeURIComponent(redirect)}`);
        return;
      }
      router.push(redirect);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setLoading(true);
    try {
      const native = isNativeApp();
      const { url } = await apiClient.auth.startOAuthGoogle({ redirect, native });
      if (native) {
        // Google blocks OAuth inside embedded WebViews, so open the flow in the
        // system browser (where the user's Google session lives). Supabase
        // redirects back to our deep link, which NativeBridge catches and hands
        // to the WebView to finish the exchange. Re-enable the button: the
        // browser now covers the app, and the deep link — not this handler —
        // resumes the flow (so the user isn't stuck if they cancel).
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url });
        setLoading(false);
      } else {
        window.location.assign(url);
        // Intentionally do not reset loading — the browser is about to
        // navigate away, and re-enabling the button would only let the
        // user click twice.
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("auth.login.googleFailed"));
      }
      setLoading(false);
    }
  }

  const pendingEmail = searchParams.get("pending");
  const resetSuccess = searchParams.get("reset") === "success";

  return (
    <div className="space-y-4">
      {resetSuccess && (
        <div className="rounded-md border border-green-600/40 bg-green-600/5 p-3 text-sm">
          ✓ {t("auth.login.resetSuccess")}
        </div>
      )}

      {pendingEmail && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          📧 {t("auth.login.pendingPrefix")}<span dir="ltr" className="font-mono">{pendingEmail}</span>.
          <br />
          {t("auth.login.pendingSuffix")}
        </div>
      )}

      <Button
        variant="outline"
        className="w-full h-11"
        onClick={handleGoogleLogin}
        disabled={loading}
        type="button"
      >
        <GoogleIcon />
        {t("auth.login.google")}
      </Button>

      <div className="relative">
        <Separator />
        <span className="absolute inset-x-0 -top-2.5 mx-auto w-fit bg-card px-2 text-xs text-muted-foreground">
          {t("auth.login.or")}
        </span>
      </div>

      <form onSubmit={handleEmailLogin} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">{t("common.email")}</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            dir="ltr"
            className="text-start"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="flex">
            <Link
              href="/forgot-password"
              className="text-xs text-primary hover:underline"
            >
              {t("auth.login.forgot")}
            </Link>
          </div>
        </div>
        <Button type="submit" className="w-full h-11" disabled={loading}>
          {loading ? t("auth.login.submitting") : t("auth.login.submit")}
        </Button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
