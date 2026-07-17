"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Shown (by the dashboard layout) when the office REQUIRES 2FA and the
// signed-in member hasn't set it up yet. Soft enforcement (v1): the
// member can dismiss for the current browser session; the prompt returns
// on the next session until they enroll.
const DISMISS_KEY = "avi.mfaPromptDismissed";

// sessionStorage is an external, browser-only, non-reactive source —
// useSyncExternalStore reads it SSR-safely (server snapshot = "dismissed",
// so nothing renders during SSR and there is no hydration flash) without a
// setState-in-effect (which react-hooks v6 forbids).
const emptySubscribe = () => () => {};
function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function MfaEnforcementPrompt() {
  const router = useRouter();
  const persistedDismissed = useSyncExternalStore(
    emptySubscribe,
    readDismissed,
    () => true,
  );
  // Local dismissal for THIS mount (clicking "לא עכשיו" / navigating away).
  const [localDismissed, setLocalDismissed] = useState(false);

  const open = !persistedDismissed && !localDismissed;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage unavailable — fall back to the local flag so it still closes.
    }
    setLocalDismissed(true);
  }

  function goToSettings() {
    // Not a session-long dismissal: if they bail out of setup, the prompt
    // returns on the next page entry.
    setLocalDismissed(true);
    router.push("/settings?tab=security");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : dismiss())}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-500" />
            <DialogTitle>המשרד שלך מחייב אימות דו-שלבי</DialogTitle>
          </div>
          <DialogDescription>
            בעל המשרד הגדיר אימות דו-שלבי (2FA) כחובה עבור כל חברי הצוות.
            ההגדרה אורכת כדקה: סורקים קוד QR עם אפליקציית אימות בטלפון
            ומזינים קוד חד-פעמי.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={dismiss}>
            לא עכשיו
          </Button>
          <Button type="button" onClick={goToSettings}>
            להגדרת האימות
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
