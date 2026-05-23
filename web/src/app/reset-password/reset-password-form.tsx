"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Client-side mismatch indicator — purely for UX. The server validates
  // the match too (`resetPasswordSchema.refine`), so a hostile client
  // cannot bypass it.
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) {
      toast.error("הסיסמאות לא תואמות");
      return;
    }
    setLoading(true);
    try {
      await apiClient.auth.resetPassword({ password, confirmPassword });
      toast.success("הסיסמה עודכנה.");
      router.push("/login?reset=success");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        // 401 = recovery session missing or expired (link was clicked
        // too late / opened in a different browser). Send the user back
        // to ask for a fresh link.
        if (err.code === "UNAUTHORIZED") {
          toast.error("הקישור לאיפוס לא תקף או פג תוקף. בקש קישור חדש.");
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">סיסמה חדשה</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">לפחות 8 תווים</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">אישור סיסמה</Label>
        <Input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
          required
          aria-invalid={mismatch || undefined}
        />
        {mismatch && (
          <p className="text-xs text-destructive">הסיסמאות לא תואמות</p>
        )}
      </div>
      <Button
        type="submit"
        className="w-full h-11"
        disabled={loading || mismatch}
      >
        {loading ? "מעדכן..." : "עדכן סיסמה"}
      </Button>
    </form>
  );
}
