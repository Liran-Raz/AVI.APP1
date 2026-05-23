import "server-only";
import type { NextRequest } from "next/server";

import { requireUser } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as teamService from "@/server/services/team.service";
import { acceptInvitationSchema } from "@/server/validators/team.schema";

// POST /api/invite/accept
// Body: { token }
// Returns: { success: true, data: AcceptInvitationDTO }
//
// The accept_invitation RPC requires an authenticated caller. We
// enforce that here too (requireUser) before even hashing the token,
// so unauthenticated requests get a clean 401 instead of going deeper.
//
// `requireUser` (not `requireSession`) — invitee doesn't have a
// profile yet, so requireSession would 401 with "Onboarding required".
export const POST = withErrorHandler(async (request: NextRequest) => {
  await requireUser();
  const body = await request.json().catch(() => ({}));
  const input = acceptInvitationSchema.parse(body);
  const result = await teamService.acceptInvitation(input.token);
  return ok(result);
});
