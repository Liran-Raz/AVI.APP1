"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, Loader2, LogOut, ShieldCheck, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient, type MeRole } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";
import type { SettingsProfile } from "./settings-page";

const ROLE_LABEL_KEYS: Record<MeRole, MessageKey> = {
  owner: "role.owner",
  admin: "role.admin",
  employee: "role.employee",
};

function roleIcon(role: MeRole) {
  switch (role) {
    case "owner":
      return <Crown className="size-3" />;
    case "admin":
      return <ShieldCheck className="size-3" />;
    default:
      return <User className="size-3" />;
  }
}

export function ProfileForm({ initial }: { initial: SettingsProfile }) {
  const router = useRouter();
  const t = useT();
  // Baseline reflects what's persisted; updated after a successful save so the
  // dirty check + "no changes" state stay accurate without a refetch.
  const [savedName, setSavedName] = useState(initial.fullName);
  const [savedPhone, setSavedPhone] = useState(initial.phone ?? "");
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    fullName.trim() !== savedName.trim() || phone.trim() !== savedPhone.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error(t("settings.profile.nameRequired"));
      return;
    }
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiClient.me.updateProfile({
        fullName: fullName.trim(),
        phone: phone.trim(),
      });
      setSavedName(updated.fullName);
      setSavedPhone(updated.phone ?? "");
      setFullName(updated.fullName);
      setPhone(updated.phone ?? "");
      toast.success(t("settings.profile.updated"));
      // Server components (e.g. the sidebar avatar initials) re-read the name.
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        toast.error(err.message);
      } else {
        setError(t("common.unexpectedError"));
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    try {
      await apiClient.auth.signOut();
    } catch {
      // best-effort — leave the protected area regardless.
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5"
      >
        <div className="space-y-2">
          <Label htmlFor="fullName">{t("settings.profile.fullName")}</Label>
          <Input
            id="fullName"
            value={fullName}
            onChange={(e) => {
              if (error) setError(null);
              setFullName(e.target.value);
            }}
            maxLength={120}
            required
            autoComplete="name"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "profile-error" : undefined}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t("common.email")}</Label>
          <Input id="email" value={initial.email} readOnly disabled dir="ltr" />
          <p className="text-xs text-muted-foreground">
            {t("settings.profile.emailHint")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">{t("common.phone")}</Label>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => {
              if (error) setError(null);
              setPhone(e.target.value);
            }}
            maxLength={50}
            dir="ltr"
            placeholder="050-0000000"
            autoComplete="tel"
          />
        </div>

        <div className="space-y-2">
          <Label>{t("settings.profile.yourRole")}</Label>
          <div>
            <Badge variant="outline" className="gap-1">
              {roleIcon(initial.role)}
              {t(ROLE_LABEL_KEYS[initial.role])}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.profile.roleHint")}
          </p>
        </div>

        <FormError id="profile-error" message={error} />

        <div className="flex justify-start pt-1">
          <Button type="submit" disabled={saving || !dirty}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t("common.saveChanges")}
          </Button>
        </div>
      </form>

      <div className="border border-border rounded-lg glass-card shadow-card p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{t("settings.profile.logoutTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("settings.profile.logoutHint")}</p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut className="size-4" />
          {t("appShell.logout")}
        </Button>
      </div>
    </div>
  );
}
