"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";

// Anti-leak by design: regardless of whether the email belongs to a real
// user (or whether the provider call succeeded server-side), we show the
// exact same generic message. The server is also coded to always return
// success for the same reason.
const GENERIC_SUCCESS_MESSAGE =
  "אם קיים משתמש עם האימייל הזה, נשלח אליו קישור לאיפוס סיסמה.";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiClient.auth.requestPasswordReset({ email });
      toast.success(GENERIC_SUCCESS_MESSAGE);
      setSubmitted(true);
    } catch (err) {
      // The server is designed to swallow everything, so reaching this
      // branch usually means a validation error (e.g. malformed email)
      // or a transport/network failure — not "email unknown".
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("שגיאה לא צפויה. נסה שוב.");
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-3 text-sm text-center">
        <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
          📧 {GENERIC_SUCCESS_MESSAGE}
        </div>
        <p className="text-muted-foreground text-xs">
          בדוק את תיבת הדואר שלך, כולל תיקיית הספאם.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">אימייל</Label>
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
      <Button type="submit" className="w-full h-11" disabled={loading}>
        {loading ? "שולח..." : "שלח קישור איפוס"}
      </Button>
    </form>
  );
}
