import "server-only";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as dashboardService from "@/server/services/dashboard.service";

// GET /api/dashboard/stats
//
// Owner-only management analytics for the office (Stage 13 R4). All figures are
// aggregated in the service from the org's active tasks — no new table. The
// owner gate is enforced in the service (the trust boundary); a non-owner gets
// 403 here even though the nav/page also hide the surface.
//   200 { ...DashboardStatsDTO }
//   401 not signed in
//   403 signed in but not the office owner
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  return ok(await dashboardService.getStats(session));
});
