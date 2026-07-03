import "server-only";

import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { isRoleManagementWriteEnabled } from "@/server/auth/role-management.flags";
import { ForbiddenError } from "@/server/errors/app-error";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as rolesService from "@/server/services/roles.service";
import {
  roleIdParamSchema,
  updateRoleSchema,
} from "@/server/validators/roles.schema";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/roles/[id] — update a custom role (name/description/permissions).
// Gated by ROLES_MANAGEMENT_WRITE FIRST (before body parsing), then owner-only in
// the service + DB. System roles are read-only (RPC refuses). Body carries
// expectedUpdatedAt for optimistic-concurrency protection.
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    if (!isRoleManagementWriteEnabled()) throw new ForbiddenError();
    const { id } = roleIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const input = updateRoleSchema.parse(body);
    const updated = await rolesService.updateRole(session, id, input);
    return ok(updated);
  },
);

// DELETE /api/roles/[id] — delete a custom role. Gated by ROLES_MANAGEMENT_WRITE
// FIRST; system roles and in-use roles are refused by the RPC.
export const DELETE = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    if (!isRoleManagementWriteEnabled()) throw new ForbiddenError();
    const { id } = roleIdParamSchema.parse(await context.params);
    await rolesService.deleteRole(session, id);
    return ok({ id });
  },
);
