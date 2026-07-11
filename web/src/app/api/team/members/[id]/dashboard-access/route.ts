import "server-only";
import type { NextRequest } from "next/server";

import { requireRole } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as teamService from "@/server/services/team.service";
import { setDashboardAccessSchema } from "@/server/validators/team.schema";

type Params = { params: Promise<{ id: string }> };

// POST /api/team/members/[id]/dashboard-access
// Body: { enabled: boolean }
// Returns: { success: true, data: MemberDTO }
//
// Owner grants/revokes a member's access to the management dashboard (Stage 13
// R4). Owner-only — the route belt requires the owner role and the service
// re-checks (activeRole === "owner") + refuses to target an owner. Requires
// migration 0022 (organization_memberships.dashboard_access).
export const POST = withErrorHandler(
  async (request: NextRequest, { params }: Params) => {
    const session = await requireRole(["owner"]);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const input = setDashboardAccessSchema.parse(body);
    const result = await teamService.setDashboardAccess(session, id, input.enabled);
    return ok(result);
  },
);
