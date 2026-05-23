import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as teamService from "@/server/services/team.service";
import { inviteSchema } from "@/server/validators/team.schema";

// POST /api/team/invitations
// Body: { email, role: "admin" | "employee" }
// Returns: { success: true, data: InvitationDTO }
//
// The DTO includes `inviteUrl` so admins can copy-paste the link when
// Resend is not configured. The raw token only ever appears in that
// URL; it is never returned outside this immediate creation response.
// `token_hash` is never returned.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = inviteSchema.parse(body);
  const result = await teamService.inviteMember(session, input);
  return ok(result);
});
