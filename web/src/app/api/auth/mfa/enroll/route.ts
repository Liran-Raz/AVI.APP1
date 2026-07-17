import "server-only";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import { requireSession } from "@/server/auth/session";
import * as authService from "@/server/services/auth.service";
import { enforceRateLimit } from "@/server/security/rate-limit";

// POST /api/auth/mfa/enroll
// Starts TOTP enrollment for the signed-in user.
// Returns: { success: true, data: { factorId, qrCode, secret } }
//
// requireSession (not requireUser) on purpose: an enrolled user whose
// session is still aal1 (mid-challenge) must NOT be able to enroll a
// replacement factor — that would let a stolen password hijack 2FA.
// Fresh users (no factor yet) are never "pending", so first-time
// enrollment passes.
export const POST = withErrorHandler(async () => {
  const session = await requireSession();
  await enforceRateLimit("mfa:enroll", session.user.id, 6, "15 m");
  const result = await authService.startTotpEnrollment();
  return ok(result);
});
