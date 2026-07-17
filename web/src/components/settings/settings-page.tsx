"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MeRole, NotificationPrefs } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";
import { LanguageSelect } from "@/components/i18n/language-switcher";

import { ProfileForm } from "./profile-form";
import { ChangePasswordForm } from "./change-password-form";
import { TwoFactorCard } from "./two-factor-card";
import { OfficeForm } from "./office-form";
import { MfaPolicyCard } from "./mfa-policy-card";
import { NotificationPrefsForm } from "./notification-prefs-form";

export type SettingsProfile = {
  fullName: string;
  email: string;
  phone: string | null;
  role: MeRole;
};

export type SettingsOrganization = {
  name: string;
  orgCode: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  // DEV-013: office-wide 2FA requirement (owner policy).
  requireMfa: boolean;
};

export function SettingsPage({
  profile,
  organization,
  isOwner,
  notificationPrefs,
  mfaEnabled,
  initialTab = "profile",
}: {
  profile: SettingsProfile;
  organization: SettingsOrganization;
  isOwner: boolean;
  notificationPrefs: NotificationPrefs;
  mfaEnabled: boolean;
  initialTab?: "profile" | "security" | "office" | "notifications";
}) {
  const t = useT();
  // Source of truth for the notifications toggle lives HERE (SettingsPage stays
  // mounted across tab switches), so the choice persists visually when the user
  // leaves and returns to the tab — Radix unmounts inactive TabsContent.
  const [notifPrefs, setNotifPrefs] = useState(notificationPrefs);
  // Same lesson for the 2FA on/off state: it must survive tab switches
  // (Radix unmounts inactive tabs), so it lives here, not in the card.
  const [mfaOn, setMfaOn] = useState(mfaEnabled);

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {t("settings.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("settings.subtitle")}
          </p>
        </div>
        {/* Language: a compact control OUTSIDE the tabs so it never changes a
            tab's height — the Settings screen stays a stable size. */}
        <div className="shrink-0 pt-1">
          <LanguageSelect />
        </div>
      </div>

      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="profile">{t("settings.tab.profile")}</TabsTrigger>
          <TabsTrigger value="security">{t("settings.tab.security")}</TabsTrigger>
          <TabsTrigger value="office">{t("settings.tab.office")}</TabsTrigger>
          <TabsTrigger value="notifications">
            {t("settings.tab.notifications")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <ProfileForm initial={profile} />
        </TabsContent>

        <TabsContent value="security" className="mt-4 space-y-4">
          <ChangePasswordForm />
          <TwoFactorCard enabled={mfaOn} onChange={setMfaOn} />
        </TabsContent>

        <TabsContent value="office" className="mt-4 space-y-4">
          <OfficeForm initial={organization} canEdit={isOwner} />
          {isOwner && (
            <MfaPolicyCard initialRequireMfa={organization.requireMfa} />
          )}
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <NotificationPrefsForm value={notifPrefs} onChange={setNotifPrefs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
