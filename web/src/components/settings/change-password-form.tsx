"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";

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
      toast.error("הסיסמאות לא תואמות");
      return;
    }
    if (sameAsCurrent) {
      toast.error("הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית");
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
      toast.success("הסיסמה עודכנה");
      reset();
    } catch (err) {
      if (err instanceof ApiError) {
        const reason = errorReason(err);
        if (reason === "wrong_current_password") {
          setWrongCurrent(true);
          toast.error("הסיסמה הנוכחית שגויה");
        } else if (reason === "same_password") {
          toast.error("הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית");
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error("שגיאה לא צפויה. נסה שוב.");
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
        <Label htmlFor="currentPassword">סיסמה נוכחית</Label>
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
          <p className="text-xs text-destructive">הסיסמה הנוכחית שגויה</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword">סיסמה חדשה</Label>
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
            הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">לפחות 8 תווים</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmNewPassword">אישור סיסמה חדשה</Label>
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
          <p className="text-xs text-destructive">הסיסמאות לא תואמות</p>
        )}
      </div>

      <div className="flex justify-start pt-1">
        <Button type="submit" disabled={loading || mismatch || sameAsCurrent}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          עדכון סיסמה
        </Button>
      </div>
    </form>
  );
}
