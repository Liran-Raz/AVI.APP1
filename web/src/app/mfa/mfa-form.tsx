"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";

function errorReason(err: ApiError): string | null {
  if (err.details && typeof err.details === "object" && "reason" in err.details) {
    const reason = (err.details as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : null;
  }
  return null;
}

// The TOTP challenge form. `next` arrives already sanitized by the server
// page; the startsWith guard below is belt-and-suspenders only.
export function MfaForm({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/tasks";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setInvalid(false);
    try {
      await apiClient.auth.mfa.verify({ code });
      // Session is now aal2 (cookie already rotated by the response).
      router.push(target);
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
      setLoading(false);
    }
    // On success we deliberately keep loading=true — the router is
    // navigating away and re-enabling the button would allow a double submit.
  }

  async function handleSignOut() {
    setLoading(true);
    try {
      await apiClient.auth.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="mfa-code">קוד אימות</Label>
        <Input
          id="mfa-code"
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
          className="text-center font-mono text-lg tracking-[0.5em]"
          autoFocus
          required
          aria-invalid={invalid || undefined}
        />
        {invalid && (
          <p className="text-xs text-destructive">
            הקוד שגוי או שפג תוקפו. הקודים מתחלפים כל 30 שניות — נסה את הקוד הנוכחי.
          </p>
        )}
      </div>
      <Button
        type="submit"
        className="w-full h-11"
        disabled={loading || code.length !== 6}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        {loading ? "מאמת..." : "אימות"}
      </Button>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={loading}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          התנתק וחזור למסך הכניסה
        </button>
      </div>
    </form>
  );
}
