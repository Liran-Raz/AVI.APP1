import "server-only";

import { getCurrentSession } from "@/server/auth/session";
import { UnauthorizedError } from "@/server/errors/app-error";
import { ok, withErrorHandler } from "@/server/errors/api-handler";

// GET /api/me
// Returns the minimal session info the frontend actually needs.
//
// We do NOT return:
//   - access/refresh tokens
//   - raw provider session
//   - full user_metadata (it may contain provider-specific opaque fields)
//   - internal IDs the frontend has no business knowing
export const GET = withErrorHandler(async () => {
  const session = await getCurrentSession();
  if (!session) throw new UnauthorizedError();

  return ok({
    user: {
      id: session.user.id,
      email: session.user.email,
    },
    profile: session.profile
      ? {
          fullName: session.profile.full_name,
          role: session.profile.role,
        }
      : null,
    organization: session.organization
      ? {
          id: session.organization.id,
          name: session.organization.name,
          orgCode: session.organization.org_code,
        }
      : null,
  });
});
