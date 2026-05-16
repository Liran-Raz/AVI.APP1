import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as authService from "@/server/services/auth.service";
import { signinSchema } from "@/server/validators/auth.schema";

// POST /api/auth/signin
// Body: { email, password }
// Returns: { success: true, data: { userId, email, needsEmailConfirmation } }
// On failure: { success: false, error: { code, message } } (401 / 400 / 500)
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const input = signinSchema.parse(body);
  const result = await authService.signIn(input);

  // Note: the auth session cookie is set automatically by the
  // server-side Supabase client; we never expose tokens in the body.
  return ok(result);
});
