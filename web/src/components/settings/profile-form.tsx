"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, Loader2, LogOut, ShieldCheck, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient, type MeRole } from "@/lib/api-client";
import type { SettingsProfile } from "./settings-page";

const ROLE_LABEL: Record<MeRole, string> = {
  owner: "בעלים",
  admin: "מנהל",
  employee: "עובד",
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
  // Baseline reflects what's persisted; updated after a successful save so the
  // dirty check + "no changes" state stay accurate without a refetch.
  const [savedName, setSavedName] = useState(initial.fullName);
  const [savedPhone, setSavedPhone] = useState(initial.phone ?? "");
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    fullName.trim() !== savedName.trim() || phone.trim() !== savedPhone.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("שם מלא הוא שדה חובה");
      return;
    }
    if (!dirty) return;
    setSaving(true);
    try {
      const updated = await apiClient.me.updateProfile({
        fullName: fullName.trim(),
        phone: phone.trim(),
      });
      setSavedName(updated.fullName);
      setSavedPhone(updated.phone ?? "");
      setFullName(updated.fullName);
      setPhone(updated.phone ?? "");
      toast.success("הפרופיל עודכן");
      // Server components (e.g. the sidebar avatar initials) re-read the name.
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else {
        toast.error("שגיאה לא צפויה");
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
          <Label htmlFor="fullName">שם מלא</Label>
          <Input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">אימייל</Label>
          <Input id="email" value={initial.email} readOnly disabled dir="ltr" />
          <p className="text-xs text-muted-foreground">
            האימייל משמש לזיהוי ולהתחברות ולא ניתן לשינוי כאן.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">טלפון</Label>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={50}
            dir="ltr"
            placeholder="050-0000000"
          />
        </div>

        <div className="space-y-2">
          <Label>התפקיד שלך</Label>
          <div>
            <Badge variant="outline" className="gap-1">
              {roleIcon(initial.role)}
              {ROLE_LABEL[initial.role]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            התפקיד נקבע ומשתנה במסך &quot;צוות&quot; ע&quot;י בעלים/מנהל.
          </p>
        </div>

        <div className="flex justify-start pt-1">
          <Button type="submit" disabled={saving || !dirty}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            שמירת שינויים
          </Button>
        </div>
      </form>

      <div className="border border-border rounded-lg glass-card shadow-card p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">התנתקות</p>
          <p className="text-xs text-muted-foreground">יציאה מהחשבון במכשיר הזה.</p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut className="size-4" />
          התנתקות
        </Button>
      </div>
    </div>
  );
}
