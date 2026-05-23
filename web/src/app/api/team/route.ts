import "server-only";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as teamService from "@/server/services/team.service";

// GET /api/team
// Returns: { success: true, data: { items: MemberDTO[] } }
//
// Lists members of the caller's organization. RLS plus the explicit
// org_id filter in the repo enforces tenant isolation. Visible to all
// authenticated members (employees see the team too — read-only).
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  const result = await teamService.listMembers(session);
  return ok(result);
});
