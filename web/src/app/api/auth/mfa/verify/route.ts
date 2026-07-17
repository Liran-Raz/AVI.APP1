import "server-only";
import type { NextRequest } from "next/server";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import { requireUser } from "@/server/auth/session";
import * as authService from "@/server/services/auth.service";
import { mfaVerifySchema } from "@/server/validators/auth.schema";
import { enforceRateLimit } from "@/server/security/rate-limit";

// POST /api/auth/mfa/verify
// Body: { code }
// The login-time challenge: verifies a code against the user's verified
// TOTP factor and elevates the session aal1 → aal2 (cookie rotates
// automatically).
//
// requireUser — NOT requireSession — because this IS the elevation path:
// requireSession rejects exactly the aal1-pending session that needs to
// call here (and recovery sessions from a password-reset link must pass
// too). The server locates the factor itself; the client only sends the
// code.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const user = await requireUser();
  // TOTP codes are 6 digits — without a tight throttle they brute-force
  // in bounded time. Provider-side MFA limits are the backstop.
  await enforceRateLimit("mfa:verify", user.id, 10, "15 m");
  const body = await request.json().catch(() => ({}));
  const input = mfaVerifySchema.parse(body);
  await authService.verifyMfaChallenge(input);
  return ok(null);
});
