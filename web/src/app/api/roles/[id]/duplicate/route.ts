import "server-only";

import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { isRoleManagementWriteEnabled } from "@/server/auth/role-management.flags";
import { ForbiddenError } from "@/server/errors/app-error";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as rolesService from "@/server/services/roles.service";
import {
  duplicateRoleSchema,
  roleIdParamSchema,
} from "@/server/validators/roles.schema";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/roles/[id]/duplicate — clone an existing role's grants into a NEW
// custom role. [id] is the SOURCE role id. Gated by ROLES_MANAGEMENT_WRITE FIRST
// (before body parsing), then owner-only in the service + the DB RPC. Returns 201.
export const POST = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    if (!isRoleManagementWriteEnabled()) throw new ForbiddenError();
    const { id } = roleIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const input = duplicateRoleSchema.parse(body);
    const created = await rolesService.duplicateRole(session, id, input);
    return ok(created, { status: 201 });
  },
);
