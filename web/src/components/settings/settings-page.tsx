"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MeRole, NotificationPrefs } from "@/lib/api-client";

import { ProfileForm } from "./profile-form";
import { ChangePasswordForm } from "./change-password-form";
import { OfficeForm } from "./office-form";
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
};

export function SettingsPage({
  profile,
  organization,
  isOwner,
  notificationPrefs,
}: {
  profile: SettingsProfile;
  organization: SettingsOrganization;
  isOwner: boolean;
  notificationPrefs: NotificationPrefs;
}) {
  // Source of truth for the notifications toggle lives HERE (SettingsPage stays
  // mounted across tab switches), so the choice persists visually when the user
  // leaves and returns to the tab — Radix unmounts inactive TabsContent.
  const [notifPrefs, setNotifPrefs] = useState(notificationPrefs);

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">הגדרות</h1>
        <p className="text-sm text-muted-foreground mt-1">
          ניהול הפרופיל, האבטחה ופרטי המשרד שלך
        </p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="profile">פרופיל</TabsTrigger>
          <TabsTrigger value="security">אבטחה</TabsTrigger>
          <TabsTrigger value="office">משרד</TabsTrigger>
          <TabsTrigger value="notifications">התראות</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <ProfileForm initial={profile} />
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <ChangePasswordForm />
        </TabsContent>

        <TabsContent value="office" className="mt-4">
          <OfficeForm initial={organization} canEdit={isOwner} />
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <NotificationPrefsForm value={notifPrefs} onChange={setNotifPrefs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
