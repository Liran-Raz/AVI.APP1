import "server-only";

import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as rolesService from "@/server/services/roles.service";
import { createRoleSchema } from "@/server/validators/roles.schema";

// GET /api/roles — list the org's roles (system + custom) with their grants.
// Authorization: roles.view (Owner or Manager); the RPC re-checks in the DB.
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  const result = await rolesService.listRoles(session);
  return ok(result);
});

// POST /api/roles — create a custom role. Owner-only + write flag; the RPC
// re-checks owner in the DB. Returns 201 with the created RoleDTO.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = createRoleSchema.parse(body);
  const created = await rolesService.createRole(session, input);
  return ok(created, { status: 201 });
});
