import "server-only";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
import { clearActiveOrgCookie } from "@/server/auth/active-org-cookie";
import * as authService from "@/server/services/auth.service";

// POST /api/auth/signout
// Body: none
// Returns: { success: true, data: null }
//
// Signing out is a best-effort idempotent operation: calling it without
// an active session is a no-op and still returns success. We also clear
// the active-office pointer so the next login resolves it fresh.
export const POST = withErrorHandler(async () => {
  await authService.signOut();
  await clearActiveOrgCookie();
  return ok(null);
});
