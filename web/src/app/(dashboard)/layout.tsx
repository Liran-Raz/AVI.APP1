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
  if (!session.profile || !session.organization) {
    // Authed but no profile yet — finish org setup first.
    redirect("/onboarding");
  }

  return (
    <AppShell profile={session.profile} organization={session.organization}>
      {children}
    </AppShell>
  );
}
