import "server-only";

import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import {
  isRoleManagementUiEnabled,
  isRoleManagementWriteEnabled,
} from "@/server/auth/role-management.flags";
import { ForbiddenError } from "@/server/errors/app-error";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as rolesService from "@/server/services/roles.service";
import { createRoleSchema } from "@/server/validators/roles.schema";

// GET /api/roles — list the org's roles (system + custom) with their grants.
// Gated by ROLES_MANAGEMENT_UI (the read surface) FIRST, so the RPC is not
// callable before the migration + feature gate are ready; then roles.view
// (Owner/Manager) in the service + the DB RPC.
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  if (!isRoleManagementUiEnabled()) throw new ForbiddenError();
  const result = await rolesService.listRoles(session);
  return ok(result);
});

// POST /api/roles — create a custom role. Gated by ROLES_MANAGEMENT_WRITE FIRST
// (before any body parsing), then owner-only in the service + the DB RPC.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  if (!isRoleManagementWriteEnabled()) throw new ForbiddenError();
  const body = await request.json().catch(() => ({}));
  const input = createRoleSchema.parse(body);
  const created = await rolesService.createRole(session, input);
  return ok(created, { status: 201 });
});
