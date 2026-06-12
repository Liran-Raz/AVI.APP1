import "server-only";
import type { NextRequest } from "next/server";

import { requireRole } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as teamService from "@/server/services/team.service";
import { changeRoleSchema } from "@/server/validators/team.schema";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/team/members/[id]/role
// Body: { role: "admin" | "employee" }
// Returns: { success: true, data: MemberDTO }
//
// Service enforces: owner/admin only, no self-change, no last-owner
// demotion, only-owner-can-touch-owner. Validator rejects "owner" as a
// target role (defense in depth — service double-checks anyway).
export const PATCH = withErrorHandler(
  async (request: NextRequest, { params }: Params) => {
    // Route-level role belt (defense in depth). The service still enforces
    // the finer rules (assertCanManageTeam / assertCanAssignRole / owner
    // protection).
    const session = await requireRole(["owner", "admin"]);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const input = changeRoleSchema.parse(body);
    const result = await teamService.changeRole(session, id, input.role);
    return ok(result);
  },
);
