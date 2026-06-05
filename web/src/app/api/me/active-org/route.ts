import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as activeOrgService from "@/server/services/active-org.service";
import { setActiveOrgSchema } from "@/server/validators/active-org.schema";

// POST /api/me/active-org
// Body: { orgId }
// Returns: { success: true, data: { activeOrgId } }
//
// Switches the active office. requireSession guarantees the caller is
// authenticated and already in at least one office; the service then
// validates an ACTIVE membership in the target org before writing the
// `avi.activeOrg` cookie. After a successful switch the client should
// router.refresh() so server components re-render in the new scope.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = setActiveOrgSchema.parse(body);
  const result = await activeOrgService.setActiveOrg(session, input.orgId);
  return ok(result);
});
