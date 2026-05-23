import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as authService from "@/server/services/auth.service";
import * as teamService from "@/server/services/team.service";
import { ValidationError } from "@/server/errors/app-error";
import { inviteSignupSchema } from "@/server/validators/team.schema";

// POST /api/invite/signup
// Body: { token, password, fullName }
// Returns: { success: true, data: { userId, email, needsEmailConfirmation } }
//
// Dedicated signup endpoint for invited users. We do not reuse
// /api/auth/signup because:
//   • email is derived from the invitation (the user never types it)
//   • orgName/orgCode are not collected (the org already exists)
//   • emailRedirectTo must point to /invite/accept?token=... so the
//     post-confirmation flow lands on acceptance, not /onboarding
//
// We validate the invitation BEFORE calling supabase.auth.signUp so a
// bogus token never creates a stray auth.users row.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const input = inviteSignupSchema.parse(body);

  // Validate the invitation server-side and derive the email from it.
  // previewInvitation throws NotFoundError if the token is unknown.
  const preview = await teamService.previewInvitation(input.token);

  if (preview.status !== "pending") {
    throw new ValidationError(
      "Invitation is no longer valid. Ask the admin to send a new one.",
    );
  }
  if (new Date(preview.expiresAt) < new Date()) {
    throw new ValidationError(
      "Invitation has expired. Ask the admin to send a new one.",
    );
  }

  // Hand off to the standard signup path, but with the
  // post-confirmation redirect pointing at /invite/accept and the
  // email derived from the invitation (never from user input).
  const result = await authService.signUp({
    email: preview.email,
    password: input.password,
    fullName: input.fullName,
    next: `/invite/accept?token=${input.token}`,
  });

  return ok(result);
});
