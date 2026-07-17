"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, apiClient, type MfaEnrollResult } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";

function errorReason(err: ApiError): string | null {
  if (typeof err.details === "object" && err.details !== null) {
    const r = (err.details as { reason?: unknown }).reason;
    if (typeof r === "string") return r;
  }
  return null;
}

// Settings → אבטחה: enable / disable two-factor authentication (TOTP).
// The on/off state is LIFTED to SettingsPage (Radix unmounts inactive
// tabs); wizard-internal state (QR, code) stays local — abandoning it
// mid-way is fine, the next enroll cleans up the unverified factor.
export function TwoFactorCard({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const router = useRouter();
  const t = useT();
  const [enrollment, setEnrollment] = useState<MfaEnrollResult | null>(null);
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(false);
  // Disable-confirmation dialog auto-cancels after 15s of inaction so the
  // SAFE default (keep 2FA on) wins if the user walks away. `open` is
  // DERIVED from the countdown: when it reaches 0 the dialog closes with no
  // change. Deriving open (rather than a separate close effect) keeps the
  // ticking free of any synchronous setState-in-effect.
  const DISABLE_TIMEOUT = 15;
  const [disableTimer, setDisableTimer] = useState(0);
  const confirmDisableOpen = disableTimer > 0;

  useEffect(() => {
    // Tick once per second while the dialog is open; pause during the
    // in-flight disable request so a slow network can't auto-close it.
    if (disableTimer <= 0 || loading) return;
    const id = setTimeout(() => setDisableTimer((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [disableTimer, loading]);

  async function startEnrollment() {
    setLoading(true);
    try {
      const result = await apiClient.auth.mfa.enroll();
      setEnrollment(result);
      setCode("");
      setInvalid(false);
    } catch (err) {
      if (err instanceof ApiError) {
        if (errorReason(err) === "already_enrolled") {
          // Another device/tab finished enrollment first.
          toast.error(t("settings.twoFactor.alreadyEnabled"));
          onChange(true);
          router.refresh();
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollment) return;
    setLoading(true);
    setInvalid(false);
    try {
      await apiClient.auth.mfa.confirm({ factorId: enrollment.factorId, code });
      toast.success(t("settings.twoFactor.enabledSuccess"));
      setEnrollment(null);
      setCode("");
      onChange(true);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (errorReason(err) === "invalid_code") {
          setInvalid(true);
          toast.error(t("settings.twoFactor.invalidCodeToast"));
        } else if (err.code === "RATE_LIMITED") {
          toast.error(t("settings.twoFactor.rateLimited"));
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  async function disable() {
    setLoading(true);
    try {
      await apiClient.auth.mfa.disable();
      toast.success(t("settings.twoFactor.disabled"));
      setDisableTimer(0);
      onChange(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5">
      <div className="flex items-start gap-3">
        {enabled ? (
          <ShieldCheck className="size-5 text-green-600 shrink-0 mt-0.5" />
        ) : (
          <ShieldOff className="size-5 text-muted-foreground shrink-0 mt-0.5" />
        )}
        <div className="space-y-1">
          <h3 className="font-semibold">{t("settings.twoFactor.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {enabled
              ? t("settings.twoFactor.descEnabled")
              : t("settings.twoFactor.descDisabled")}
          </p>
        </div>
      </div>

      {/* Off → start button */}
      {!enabled && !enrollment && (
        <div className="flex justify-start">
          <Button type="button" onClick={startEnrollment} disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {t("settings.twoFactor.enableButton")}
          </Button>
        </div>
      )}

      {/* Enrollment wizard: QR + manual secret + first code */}
      {!enabled && enrollment && (
        <form onSubmit={confirmEnrollment} className="space-y-4">
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal ps-5">
            <li>{t("settings.twoFactor.step1")}</li>
            <li>{t("settings.twoFactor.step2")}</li>
            <li>{t("settings.twoFactor.step3")}</li>
          </ol>

          <div className="flex flex-col items-center gap-3">
            {/* White backing so the QR scans reliably on any theme. */}
            <div className="rounded-lg bg-white p-3 border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- provider-generated data: URI, not an optimizable asset */}
              <img
                src={enrollment.qrCode}
                alt={t("settings.twoFactor.qrAlt")}
                className="size-40"
              />
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs text-muted-foreground">
                {t("settings.twoFactor.manualKeyHint")}
              </p>
              <p
                dir="ltr"
                className="font-mono text-xs break-all select-all bg-muted rounded px-2 py-1"
              >
                {enrollment.secret}
              </p>
            </div>
          </div>

          <div className="space-y-2 max-w-xs">
            <Label htmlFor="mfa-enroll-code">{t("settings.twoFactor.codeLabel")}</Label>
            <Input
              id="mfa-enroll-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                setInvalid(false);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              dir="ltr"
              className="text-center font-mono tracking-[0.4em]"
              aria-invalid={invalid || undefined}
              required
            />
            {invalid && (
              <p className="text-xs text-destructive">
                {t("settings.twoFactor.invalidCodeInline")}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={loading || code.length !== 6}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              {t("settings.twoFactor.confirmButton")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => {
                setEnrollment(null);
                setCode("");
                setInvalid(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}

      {/* On → disable */}
      {enabled && (
        <div className="flex justify-start">
          <Button
            type="button"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setDisableTimer(DISABLE_TIMEOUT)}
            disabled={loading}
          >
            {t("settings.twoFactor.disableButton")}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("settings.twoFactor.lostAccess")}
      </p>

      <Dialog
        open={confirmDisableOpen}
        onOpenChange={(v) => {
          // Any close (Escape / outside-click / the X) = cancel = safe default.
          if (!v) setDisableTimer(0);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.twoFactor.disableConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.twoFactor.disableConfirmDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDisableTimer(0)}
              disabled={loading}
            >
              {t("common.cancel")}{!loading && ` (${disableTimer})`}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={disable}
              disabled={loading}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {t("settings.twoFactor.disableAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
