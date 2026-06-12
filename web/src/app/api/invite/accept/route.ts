import "server-only";
import type { NextRequest } from "next/server";

import { requireUser } from "@/server/auth/session";
import { writeActiveOrgCookie } from "@/server/auth/active-org-cookie";
import { clearPendingInviteCookie } from "@/server/auth/pending-invite-cookie";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as teamService from "@/server/services/team.service";
import { acceptInvitationSchema } from "@/server/validators/team.schema";
import { enforceRateLimit } from "@/server/security/rate-limit";

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
  const user = await requireUser();
  // Throttle accept attempts per authenticated user (replay/abuse).
  await enforceRateLimit("invite-accept:user", user.id, 10, "10 m");
  const body = await request.json().catch(() => ({}));
  const input = acceptInvitationSchema.parse(body);
  const result = await teamService.acceptInvitation(input.token);
  // Make the just-joined office the active one. For a brand-new user it
  // is their only office; for an existing user it's the intuitive landing
  // context after accepting. The membership was just created, so the
  // cookie passes the per-request validation on the next render.
  await writeActiveOrgCookie(result.orgId);
  // Invite consumed — clear the pending-invite carrier cookie so a later
  // visit to /onboarding doesn't re-route to the (now accepted) invite.
  await clearPendingInviteCookie();
  return ok(result);
});
