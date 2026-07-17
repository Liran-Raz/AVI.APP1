"use client";

import { useState } from "react";
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
  const [enrollment, setEnrollment] = useState<MfaEnrollResult | null>(null);
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);

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
          toast.error("אימות דו-שלבי כבר מופעל בחשבון הזה");
          onChange(true);
          router.refresh();
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error("שגיאה לא צפויה");
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
      toast.success("אימות דו-שלבי הופעל בהצלחה");
      setEnrollment(null);
      setCode("");
      onChange(true);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (errorReason(err) === "invalid_code") {
          setInvalid(true);
          toast.error("הקוד שגוי או שפג תוקפו — נסה שוב");
        } else if (err.code === "RATE_LIMITED") {
          toast.error("יותר מדי ניסיונות. המתן מספר דקות ונסה שוב.");
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error("שגיאה לא צפויה");
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
      toast.success("אימות דו-שלבי הושבת");
      setConfirmDisableOpen(false);
      onChange(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else {
        toast.error("שגיאה לא צפויה");
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
          <h3 className="font-semibold">אימות דו-שלבי (2FA)</h3>
          <p className="text-sm text-muted-foreground">
            {enabled
              ? "פעיל — בכל כניסה תתבקש להזין קוד מאפליקציית האימות בנוסף לסיסמה."
              : "שכבת הגנה נוספת לחשבון: בנוסף לסיסמה, קוד חד-פעמי מאפליקציית אימות (Google Authenticator, Microsoft Authenticator וכדומה)."}
          </p>
        </div>
      </div>

      {/* Off → start button */}
      {!enabled && !enrollment && (
        <div className="flex justify-start">
          <Button type="button" onClick={startEnrollment} disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            הפעלת אימות דו-שלבי
          </Button>
        </div>
      )}

      {/* Enrollment wizard: QR + manual secret + first code */}
      {!enabled && enrollment && (
        <form onSubmit={confirmEnrollment} className="space-y-4">
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal ps-5">
            <li>פתח את אפליקציית האימות בטלפון</li>
            <li>סרוק את קוד ה-QR (או הזן את המפתח ידנית)</li>
            <li>הזן למטה את הקוד בן 6 הספרות שמופיע באפליקציה</li>
          </ol>

          <div className="flex flex-col items-center gap-3">
            {/* White backing so the QR scans reliably on any theme. */}
            <div className="rounded-lg bg-white p-3 border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- provider-generated data: URI, not an optimizable asset */}
              <img
                src={enrollment.qrCode}
                alt="קוד QR להוספת החשבון לאפליקציית האימות"
                className="size-40"
              />
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs text-muted-foreground">
                לא מצליח לסרוק? הזן את המפתח הזה ידנית:
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
            <Label htmlFor="mfa-enroll-code">קוד מהאפליקציה</Label>
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
                הקוד שגוי או שפג תוקפו. הקודים מתחלפים כל 30 שניות.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={loading || code.length !== 6}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              אישור והפעלה
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
              ביטול
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
            onClick={() => setConfirmDisableOpen(true)}
            disabled={loading}
          >
            השבתת אימות דו-שלבי
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        איבדת גישה לאפליקציית האימות? פנה לתמיכת המערכת לשחזור הגישה לחשבון.
      </p>

      <Dialog open={confirmDisableOpen} onOpenChange={setConfirmDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>להשבית את האימות הדו-שלבי?</DialogTitle>
            <DialogDescription>
              החשבון יהיה מוגן בסיסמה בלבד. אם המשרד שלך מחייב אימות דו-שלבי,
              תתבקש להפעיל אותו מחדש.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDisableOpen(false)}
              disabled={loading}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={disable}
              disabled={loading}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              השבתה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
