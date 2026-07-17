import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import { requireSession } from "@/server/auth/session";
import * as authService from "@/server/services/auth.service";
import { mfaConfirmSchema } from "@/server/validators/auth.schema";
import { enforceRateLimit } from "@/server/security/rate-limit";

// POST /api/auth/mfa/confirm
// Body: { factorId, code }
// Completes TOTP enrollment with the first authenticator code. On success
// the factor becomes verified and THIS session is elevated to aal2 (the
// session cookie rotates automatically).
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  // Same budget as the login-time challenge — 6-digit codes brute-force
  // fast without a throttle.
  await enforceRateLimit("mfa:verify", session.user.id, 10, "15 m");
  const body = await request.json().catch(() => ({}));
  const input = mfaConfirmSchema.parse(body);
  await authService.confirmTotpEnrollment(input);
  return ok(null);
});
