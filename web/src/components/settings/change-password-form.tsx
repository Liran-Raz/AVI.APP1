"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";

// Stable server-tagged reasons (see auth.service.changePassword +
// supabase-auth.adapter.updatePassword) → clear inline Hebrew messages
// instead of raw provider text.
function errorReason(err: ApiError): string | null {
  if (typeof err.details === "object" && err.details !== null) {
    const r = (err.details as { reason?: unknown }).reason;
    if (typeof r === "string") return r;
  }
  return null;
}

export function ChangePasswordForm() {
  const t = useT();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Set when the server rejects the current password. Cleared as soon as the
  // user edits that field so the indicator never lingers.
  const [wrongCurrent, setWrongCurrent] = useState(false);

  // Client-side hints — the server re-validates all of this.
  const mismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
  const sameAsCurrent =
    newPassword.length > 0 && newPassword === currentPassword;

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) {
      toast.error(t("settings.security.mismatch"));
      return;
    }
    if (sameAsCurrent) {
      toast.error(t("settings.security.mustDiffer"));
      return;
    }
    setLoading(true);
    setWrongCurrent(false);
    try {
      await apiClient.auth.changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      toast.success(t("settings.security.updated"));
      reset();
    } catch (err) {
      if (err instanceof ApiError) {
        const reason = errorReason(err);
        if (reason === "wrong_current_password") {
          setWrongCurrent(true);
          toast.error(t("settings.security.wrongCurrent"));
        } else if (reason === "same_password") {
          toast.error(t("settings.security.mustDiffer"));
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
    <form
      onSubmit={handleSubmit}
      className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5"
    >
      <div className="space-y-2">
        <Label htmlFor="currentPassword">{t("settings.security.currentPassword")}</Label>
        <Input
          id="currentPassword"
          type="password"
          value={currentPassword}
          onChange={(e) => {
            setCurrentPassword(e.target.value);
            if (wrongCurrent) setWrongCurrent(false);
          }}
          required
          autoComplete="current-password"
          aria-invalid={wrongCurrent || undefined}
        />
        {wrongCurrent && (
          <p className="text-xs text-destructive">{t("settings.security.wrongCurrent")}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword">{t("settings.security.newPassword")}</Label>
        <Input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          required
          autoComplete="new-password"
          aria-invalid={sameAsCurrent || undefined}
        />
        {sameAsCurrent ? (
          <p className="text-xs text-destructive">
            {t("settings.security.mustDiffer")}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("settings.security.min8")}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmNewPassword">{t("settings.security.confirmPassword")}</Label>
        <Input
          id="confirmNewPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
          required
          autoComplete="new-password"
          aria-invalid={mismatch || undefined}
        />
        {mismatch && (
          <p className="text-xs text-destructive">{t("settings.security.mismatch")}</p>
        )}
      </div>

      <div className="flex justify-start pt-1">
        <Button type="submit" disabled={loading || mismatch || sameAsCurrent}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          {t("settings.security.updateButton")}
        </Button>
      </div>
    </form>
  );
}
