import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as authService from "@/server/services/auth.service";
import { signupSchema } from "@/server/validators/auth.schema";

// POST /api/auth/signup
// Body: { email, password, fullName }
// Returns: { success: true, data: { userId, email, needsEmailConfirmation } }
// On failure: { success: false, error: { code, message } } (409 / 400 / 500)
//
// We deliberately do NOT return raw session, tokens, or provider metadata.
// The client will know if the user needs to confirm via `needsEmailConfirmation`.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const input = signupSchema.parse(body);
  const result = await authService.signUp(input);
  return ok(result);
});
