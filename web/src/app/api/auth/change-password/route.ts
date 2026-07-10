import "server-only";
import type { NextRequest } from "next/server";

import { requireUser } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import { ValidationError } from "@/server/errors/app-error";
import * as authService from "@/server/services/auth.service";
import { changePasswordSchema } from "@/server/validators/auth.schema";

// POST /api/auth/change-password
// Body: { currentPassword, newPassword, confirmPassword }
// Logged-in password change — verifies the CURRENT password before setting a
// new one. Returns: { success: true, data: null }
export const POST = withErrorHandler(async (request: NextRequest) => {
  const user = await requireUser();
  if (!user.email) {
    // All password-based users have an email identity; an OAuth-only account
    // with no email cannot re-authenticate by password here.
    throw new ValidationError("Password change is unavailable for this account");
  }

  const body = await request.json().catch(() => ({}));
  const input = changePasswordSchema.parse(body);

  await authService.changePassword({
    email: user.email,
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
  });

  return ok(null);
});
