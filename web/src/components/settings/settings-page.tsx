"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MeRole } from "@/lib/api-client";

import { ProfileForm } from "./profile-form";
import { ChangePasswordForm } from "./change-password-form";
import { OfficeForm } from "./office-form";

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
}: {
  profile: SettingsProfile;
  organization: SettingsOrganization;
  isOwner: boolean;
}) {
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
      </Tabs>
    </div>
  );
}
