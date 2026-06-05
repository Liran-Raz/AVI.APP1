import { redirect } from "next/navigation";

import { AppShell } from "@/components/dashboard/app-shell";
import { getCurrentSession } from "@/server/auth/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.activeOrg) {
    // Authed but no active office (no profile yet, or deactivated
    // everywhere) — finish / create org setup first.
    redirect("/onboarding");
  }

  const offices = session.memberships.map((m) => ({
    orgId: m.orgId,
    name: m.orgName,
    role: m.role,
  }));

  return (
    <AppShell
      profile={session.profile}
      organization={session.activeOrg}
      memberships={offices}
      activeOrgId={session.activeOrg.id}
    >
      {children}
    </AppShell>
  );
}
