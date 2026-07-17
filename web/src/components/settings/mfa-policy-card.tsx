"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, apiClient } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";

// Settings → משרד (owner only): office-wide 2FA requirement. Soft
// enforcement — members without 2FA get a persistent setup prompt on
// entry; nothing blocks them outright (v1).
export function MfaPolicyCard({
  initialRequireMfa,
}: {
  initialRequireMfa: boolean;
}) {
  const router = useRouter();
  const t = useT();
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
          ? t("settings.mfaPolicy.enabledToast")
          : t("settings.mfaPolicy.disabledToast"),
      );
      router.refresh();
    } catch (err) {
      setRequireMfa(!next);
      if (err instanceof ApiError) toast.error(err.message);
      else {
        toast.error(t("common.unexpectedError"));
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
          <h3 className="font-semibold">{t("settings.mfaPolicy.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("settings.mfaPolicy.description")}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="require-mfa" className="cursor-pointer">
          {t("settings.mfaPolicy.toggleLabel")}
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
