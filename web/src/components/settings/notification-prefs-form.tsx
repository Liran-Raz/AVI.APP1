"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, apiClient, type NotificationPrefs } from "@/lib/api-client";

export function NotificationPrefsForm({
  initial,
}: {
  initial: NotificationPrefs;
}) {
  const [emailOnTaskAssignment, setEmailOnTaskAssignment] = useState(
    initial.emailOnTaskAssignment,
  );
  const [saving, setSaving] = useState(false);

  async function toggleEmailOnAssignment(next: boolean) {
    const prev = emailOnTaskAssignment;
    setEmailOnTaskAssignment(next); // optimistic
    setSaving(true);
    try {
      const updated = await apiClient.me.updateNotificationPrefs({
        emailOnTaskAssignment: next,
      });
      setEmailOnTaskAssignment(updated.emailOnTaskAssignment);
      toast.success("ההעדפות עודכנו");
    } catch (err) {
      setEmailOnTaskAssignment(prev); // rollback
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
          checked={emailOnTaskAssignment}
          onCheckedChange={toggleEmailOnAssignment}
          disabled={saving}
        />
      </div>
    </div>
  );
}
