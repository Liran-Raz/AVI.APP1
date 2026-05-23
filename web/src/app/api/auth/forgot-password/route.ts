import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as authService from "@/server/services/auth.service";
import { forgotPasswordSchema } from "@/server/validators/auth.schema";

// POST /api/auth/forgot-password
// Body: { email }
// Returns: { success: true, data: null }
//
// Anti-leak: always returns success regardless of whether the email
// belongs to a real user. The service swallows provider errors and
// logs them server-side; clients cannot tell the difference. This
// matches the safe-by-default behavior of Supabase Auth itself.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const input = forgotPasswordSchema.parse(body);
  await authService.requestPasswordReset(input);
  return ok(null);
});
