"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, apiClient, type NotificationPrefs } from "@/lib/api-client";

// Controlled: the source of truth lives in SettingsPage (which stays mounted
// across tab switches), so toggling here — and then leaving/returning to the
// tab — no longer "resets" to the server-render value. Radix unmounts inactive
// tab content, so a form-local useState would be lost on every tab change.
export function NotificationPrefsForm({
  value,
  onChange,
}: {
  value: NotificationPrefs;
  onChange: (next: NotificationPrefs) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function toggleEmailOnAssignment(next: boolean) {
    const prev = value;
    onChange({ ...value, emailOnTaskAssignment: next }); // optimistic (parent)
    setSaving(true);
    try {
      const updated = await apiClient.me.updateNotificationPrefs({
        emailOnTaskAssignment: next,
      });
      onChange(updated); // confirm with the persisted server value
      toast.success("ההעדפות עודכנו");
    } catch (err) {
      onChange(prev); // rollback
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
    <div className="border border-border rounded-lg glass-card shadow-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="emailOnTaskAssignment" className="text-sm font-medium">
            מייל בשיוך משימה חדשה
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            קבלת אימייל כשמשימה חדשה משויכת אליך. ההתראה בפעמון בתוך המערכת תמשיך
            להופיע כרגיל.
          </p>
        </div>
        <Switch
          id="emailOnTaskAssignment"
          checked={value.emailOnTaskAssignment}
          onCheckedChange={toggleEmailOnAssignment}
          disabled={saving}
        />
      </div>
    </div>
  );
}
