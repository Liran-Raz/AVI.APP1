import { redirect } from "next/navigation";

import { getCurrentSession } from "@/server/auth/session";
import { SettingsPage } from "@/components/settings/settings-page";

export default async function SettingsRoute() {
  // (dashboard)/layout already enforces auth + completed onboarding — these
  // guards repeat the contract for type narrowing and give us the full
  // profile + active office to seed the forms.
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.activeOrg || !session.activeRole) {
    redirect("/onboarding");
  }

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
      }}
      isOwner={session.activeRole === "owner"}
    />
  );
}
