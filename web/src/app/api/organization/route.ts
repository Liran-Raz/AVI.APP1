import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as organizationService from "@/server/services/organization.service";
import { updateOrganizationSchema } from "@/server/validators/organization.schema";

// PATCH /api/organization
// Body: { name?, email?, phone?, address? } — update the ACTIVE office's
// details. Owner-only (enforced in the service + DB RLS).
// Returns: { success: true, data: OrganizationDTO }
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = updateOrganizationSchema.parse(body);
  const org = await organizationService.updateOrganization(session, input);
  return ok(org);
});
