import { redirect } from "next/navigation";

import { AppShell } from "@/components/dashboard/app-shell";
import { getCurrentUser } from "@/lib/supabase/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentUser();
  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell profile={session.profile} organization={session.organization}>
      {children}
    </AppShell>
  );
}
