import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as authService from "@/server/services/auth.service";
import { signupSchema } from "@/server/validators/auth.schema";
import { clientIp, enforceRateLimit } from "@/server/security/rate-limit";

// POST /api/auth/signup
// Body: { email, password, fullName }
// Returns: { success: true, data: { email, needsEmailConfirmation } }
// On failure: { success: false, error: { code, message } } (400 / 500)
//
// Anti-enumeration: the response is uniform whether or not the email is
// already registered — no userId, and needsEmailConfirmation is true in
// both cases. We never return raw session, tokens, or provider metadata.
export const POST = withErrorHandler(async (request: NextRequest) => {
  // Throttle signup abuse per IP (keeps Stage 2 anti-enumeration intact —
  // the 429 is uniform and reveals nothing about any email).
  await enforceRateLimit("signup:ip", clientIp(request.headers), 5, "1 h");

  const body = await request.json().catch(() => ({}));
  const input = signupSchema.parse(body);
  const result = await authService.signUp(input);
  // Anti-enumeration: return a uniform shape that does NOT reveal whether
  // the email already exists — no userId, and needsEmailConfirmation is
  // true for both a fresh signup (email confirmation is enabled) and an
  // already-registered email (the service collapses that case).
  return ok({
    email: result.email,
    needsEmailConfirmation: result.needsEmailConfirmation,
  });
});
