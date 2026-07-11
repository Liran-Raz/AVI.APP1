import { redirect } from "next/navigation";

import { getCurrentSession, type FullSession } from "@/server/auth/session";
import * as dashboardService from "@/server/services/dashboard.service";
import { DashboardAnalytics } from "@/components/dashboard-analytics/dashboard-analytics";
import { DashboardNoAccess } from "@/components/dashboard-analytics/dashboard-no-access";

// Management dashboard (Stage 13 R4). Access = the owner, or a member the owner
// granted access to (canViewDashboard). A signed-in member WITHOUT access sees
// a friendly "no permission" screen (not a 404) so they understand the page
// exists but is owner-gated. The service re-checks the same rule — that is the
// authoritative gate. (dashboard)/layout already enforced auth + onboarding.
export default async function DashboardRoute() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.activeOrg || !session.activeRole) {
    redirect("/onboarding");
  }
  const full = session as FullSession;
  if (!dashboardService.canViewDashboard(full)) {
    return <DashboardNoAccess />;
  }

  const stats = await dashboardService.getStats(full);
  return <DashboardAnalytics stats={stats} officeName={full.activeOrg.name} />;
}
