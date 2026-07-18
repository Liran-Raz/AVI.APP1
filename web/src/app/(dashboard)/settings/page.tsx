import { redirect } from "next/navigation";

import { getCurrentSession } from "@/server/auth/session";
import { getNotificationPrefs } from "@/server/services/profile.service";
import { SettingsPage } from "@/components/settings/settings-page";

const SETTINGS_TABS = [
  "profile",
  "security",
  "office",
  "notifications",
  "accessibility",
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export default async function SettingsRoute(props: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // (dashboard)/layout already enforces auth + completed onboarding — these
  // guards repeat the contract for type narrowing and give us the full
  // profile + active office to seed the forms.
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.activeOrg || !session.activeRole) {
    redirect("/onboarding");
  }

  // Deep-link support (?tab=security) — used by the 2FA enforcement prompt.
  const { tab } = await props.searchParams;
  const initialTab: SettingsTab = SETTINGS_TABS.includes(tab as SettingsTab)
    ? (tab as SettingsTab)
    : "profile";

  return (
    <SettingsPage
      profile={{
        fullName: session.profile.full_name,
        email: session.profile.email,
        phone: session.profile.phone,
        role: session.activeRole,
      }}
      organization={{
        name: session.activeOrg.name,
        orgCode: session.activeOrg.org_code,
        email: session.activeOrg.email,
        phone: session.activeOrg.phone,
        address: session.activeOrg.address,
        // Defensive read — the column lands with migration 0028.
        requireMfa: session.activeOrg.require_mfa === true,
      }}
      isOwner={session.activeRole === "owner"}
      notificationPrefs={getNotificationPrefs(session.profile)}
      mfaEnabled={session.user.hasVerifiedTotp}
      initialTab={initialTab}
    />
  );
}
