import "server-only";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import { requireSession } from "@/server/auth/session";
import * as authService from "@/server/services/auth.service";

// POST /api/auth/mfa/disable
// Removes the user's TOTP factors (turns 2FA off). requireSession means
// the caller is necessarily aal2 (an enrolled user can't pass the MFA
// gate otherwise) — which is exactly what the provider demands for
// unenrolling a verified factor. No password re-auth here: a password
// sign-in would downgrade the session to aal1 and the provider would
// then refuse the unenroll itself.
export const POST = withErrorHandler(async () => {
  await requireSession();
  await authService.disableTotp();
  return ok(null);
});
