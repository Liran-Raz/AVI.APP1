import "server-only";
import type { NextRequest } from "next/server";

import { requireUser } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as authService from "@/server/services/auth.service";
import { resetPasswordSchema } from "@/server/validators/auth.schema";

// POST /api/auth/reset-password
// Body: { password, confirmPassword }
// Returns: { success: true, data: null }
//
// Requires an active session — typically the recovery session set when
// the user clicked the email link and /auth/confirm verified the OTP
// with type=recovery. `confirmPassword` is validated server-side too
// (not only client-side) to ensure no client can bypass it.
export const POST = withErrorHandler(async (request: NextRequest) => {
  // 401 if no session at all (link expired / never clicked).
  await requireUser();

  const body = await request.json().catch(() => ({}));
  const input = resetPasswordSchema.parse(body);

  // The schema already enforced password === confirmPassword. We only
  // forward `password` to the provider — `confirmPassword` is never
  // sent further.
  await authService.resetPassword({ password: input.password });

  return ok(null);
});
