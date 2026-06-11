"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError, apiClient } from "@/lib/api-client";

type Props = {
  token: string;
  invitedEmail: string;
  currentUserEmail: string;
  hasExistingProfile: boolean;
};

// Client-side accept button. Two states:
//   1. Logged-in user without a profile → show "Accept invitation" button.
//      The server RPC re-validates email-match and pending-status.
//   2. Logged-in user WITH a profile → show "you're already a member"
//      message + sign-out shortcut (let them log in as the invited user).
export function AcceptClient({
  token,
  invitedEmail,
  currentUserEmail,
  hasExistingProfile,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // The page already showed the invite preview; here we tell the user
  // clearly which account is logged in and which account was invited,
  // since they might be different.
  const emailMismatch =
    invitedEmail.toLowerCase() !== currentUserEmail.toLowerCase();

  async function handleAccept() {
    setLoading(true);
    try {
      const result = await apiClient.invite.accept({ token });
      toast.success("הצטרפת למשרד");
      router.push("/tasks");
      router.refresh();
      // result is intentionally unused beyond the toast — the RPC
      // creates the profile, then the redirect picks up the new session.
      void result;
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogoutAndRelink() {
    try {
      await apiClient.auth.signOut();
    } catch {
      // signOut is idempotent — proceed regardless.
    }
    const acceptUrl = `/invite/accept?token=${encodeURIComponent(token)}`;
    router.push(`/login?redirect=${encodeURIComponent(acceptUrl)}`);
    router.refresh();
  }

  // Multi-office: an already-onboarded user CAN accept an invite to a
  // *different* office — the accept RPC creates a second membership (or
  // returns a clean "already a member of this org" conflict). So only block
  // the accept button when the logged-in account is the WRONG one (email
  // mismatch) and guide them to switch accounts; a matching email proceeds.
  if (hasExistingProfile && emailMismatch) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          אתה כבר חבר בארגון אחר. כדי לאשר את ההזמנה הזו, התנתק והיכנס עם החשבון
          שאליו ההזמנה נשלחה (
          <span dir="ltr" className="font-mono">
            {invitedEmail}
          </span>
          ).
        </div>
        <Button
          variant="outline"
          className="w-full h-11"
          onClick={handleLogoutAndRelink}
        >
          <LogOut className="size-4" />
          התנתק והיכנס מחדש
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
        <div>
          <span className="text-muted-foreground">החשבון שלך:</span>{" "}
          <span dir="ltr" className="font-mono">
            {currentUserEmail}
          </span>
        </div>
        <div className="mt-1">
          <span className="text-muted-foreground">ההזמנה ל:</span>{" "}
          <span dir="ltr" className="font-mono">
            {invitedEmail}
          </span>
        </div>
      </div>

      {emailMismatch && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          האימיילים לא תואמים. ההזמנה תידחה בשרת. התנתק והיכנס עם האימייל הנכון.
        </div>
      )}

      <Button
        className="w-full h-11"
        onClick={handleAccept}
        disabled={loading || emailMismatch}
      >
        {loading ? "מצטרף..." : "אשר הזמנה"}
      </Button>
    </div>
  );
}
