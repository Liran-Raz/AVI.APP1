"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, apiClient } from "@/lib/api-client";

// Settings → משרד (owner only): office-wide 2FA requirement. Soft
// enforcement — members without 2FA get a persistent setup prompt on
// entry; nothing blocks them outright (v1).
export function MfaPolicyCard({
  initialRequireMfa,
}: {
  initialRequireMfa: boolean;
}) {
  const router = useRouter();
  const [requireMfa, setRequireMfa] = useState(initialRequireMfa);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    // Optimistic; revert on failure (same pattern as notification prefs).
    setRequireMfa(next);
    setSaving(true);
    try {
      const updated = await apiClient.organization.update({ requireMfa: next });
      setRequireMfa(updated.requireMfa);
      toast.success(
        updated.requireMfa
          ? "אימות דו-שלבי הוגדר כחובה לכל המשרד"
          : "חובת האימות הדו-שלבי בוטלה",
      );
      router.refresh();
    } catch (err) {
      setRequireMfa(!next);
      if (err instanceof ApiError) toast.error(err.message);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-border rounded-lg glass-card shadow-card p-6 space-y-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="size-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="font-semibold">מדיניות אבטחה משרדית</h3>
          <p className="text-sm text-muted-foreground">
            חיוב כל חברי המשרד להפעיל אימות דו-שלבי. מי שטרם הפעיל יקבל
            חלון הנחיה בכניסה למערכת עם קישור להגדרה.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="require-mfa" className="cursor-pointer">
          חיוב אימות דו-שלבי לכל המשרד
        </Label>
        <Switch
          id="require-mfa"
          checked={requireMfa}
          onCheckedChange={toggle}
          disabled={saving}
        />
      </div>
    </div>
  );
}
