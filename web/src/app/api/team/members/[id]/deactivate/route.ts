import "server-only";
import type { NextRequest } from "next/server";

import { requireRole } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as teamService from "@/server/services/team.service";

type Params = { params: Promise<{ id: string }> };

// POST /api/team/members/[id]/deactivate
// Returns: { success: true, data: MemberDTO }
//
// Soft "remove" — sets is_active=false on the profile. Acceptable for
// MVP: existing sessions on the deactivated user expire on their own
// (Supabase token lifetime, typically ~1 hour). New task assignments
// won't target them and they won't appear in active member lists.
// Hard removal of a user would require admin operations against
// auth.users, which would in turn require the service role key — we
// deliberately don't expose that path.
//
// Service enforces: owner/admin only, no self-deactivation, only-owner
// can deactivate owner, no last-owner deactivation.
export const POST = withErrorHandler(
  async (_request: NextRequest, { params }: Params) => {
    // Route-level coarse belt (defense in depth). The service is authoritative:
    // requirePermission(TEAM_DEACTIVATE) + owner protection.
    const session = await requireRole(["owner", "admin"]);
    const { id } = await params;
    const result = await teamService.deactivateMember(session, id);
    return ok(result);
  },
);
