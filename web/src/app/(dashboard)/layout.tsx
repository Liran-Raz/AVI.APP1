import { redirect } from "next/navigation";

import { AppShell } from "@/components/dashboard/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const session = await getCurrentUser();
  if (!session) {
    // Authed but no profile yet — finish org setup first.
    redirect("/onboarding");
  }

  return (
    <AppShell profile={session.profile} organization={session.organization}>
      {children}
    </AppShell>
  );
}
