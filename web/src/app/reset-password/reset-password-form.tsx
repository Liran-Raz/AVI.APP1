"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";

// The server (Supabase) is the only party that knows the current password,
// so "you chose the same password" can only be detected AFTER submit. The
// adapter tags that case with a stable `details.reason` so we can show a
// clear Hebrew message here instead of the raw English provider text.
function isSamePasswordError(err: ApiError): boolean {
  return (
    typeof err.details === "object" &&
    err.details !== null &&
    (err.details as { reason?: unknown }).reason === "same_password"
  );
}

export function ResetPasswordForm() {
  const t = useT();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Set when the server reports the new password equals the current one.
  // Cleared as soon as the user edits the password (see onChange), so the
  // indicator never lingers once they type something different.
  const [sameAsCurrent, setSameAsCurrent] = useState(false);

  // Client-side mismatch indicator — purely for UX. The server validates
  // the match too (`resetPasswordSchema.refine`), so a hostile client
  // cannot bypass it.
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) {
      toast.error(t("auth.reset.mismatch"));
      return;
    }
    setLoading(true);
    setSameAsCurrent(false);
    try {
      await apiClient.auth.resetPassword({ password, confirmPassword });
      toast.success(t("auth.reset.updatedToast"));
      router.push("/login?reset=success");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        // 401 = recovery session missing or expired (link was clicked
        // too late / opened in a different browser). Send the user back
        // to ask for a fresh link.
        if (err.code === "UNAUTHORIZED") {
          toast.error(t("auth.reset.linkExpired"));
        } else if (isSamePasswordError(err)) {
          // Persistent inline indicator + toast so the reason is obvious.
          setSameAsCurrent(true);
          toast.error(t("auth.reset.sameAsCurrent"));
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error(t("common.unexpectedErrorRetry"));
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.reset.newPassword")}</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            // Once they change the password, the "same as current"
            // indicator is stale — clear it immediately.
            if (sameAsCurrent) setSameAsCurrent(false);
          }}
          minLength={8}
          autoComplete="new-password"
          required
          aria-invalid={sameAsCurrent || undefined}
          aria-describedby="reset-password-hint"
        />
        {sameAsCurrent ? (
          <p
            id="reset-password-hint"
            role="alert"
            className="text-xs text-destructive"
          >
            {t("auth.reset.sameAsCurrent")}
          </p>
        ) : (
          <p id="reset-password-hint" className="text-xs text-muted-foreground">
            {t("auth.passwordHint")}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t("auth.reset.confirmPassword")}</Label>
        <Input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
          autoComplete="new-password"
          required
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? "reset-confirm-msg" : undefined}
        />
        {mismatch && (
          <p id="reset-confirm-msg" role="alert" className="text-xs text-destructive">
            {t("auth.reset.mismatch")}
          </p>
        )}
      </div>
      <Button
        type="submit"
        className="w-full h-11"
        disabled={loading || mismatch}
      >
        {loading ? t("auth.reset.submitting") : t("auth.reset.submit")}
      </Button>
    </form>
  );
}
