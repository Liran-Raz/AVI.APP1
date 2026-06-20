import "server-only";

import { getCurrentSession, type FullSession } from "@/server/auth/session";
import { resolveCapabilities } from "@/server/auth/authorization";
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
    // `organization` is the ACTIVE office (kept for backward compat).
    organization: session.organization
      ? {
          id: session.organization.id,
          name: session.organization.name,
          orgCode: session.organization.org_code,
        }
      : null,
    // Every active office the user belongs to — drives the office
    // switcher. No secrets: org name/code + the caller's role.
    memberships: session.memberships.map((m) => ({
      orgId: m.orgId,
      name: m.orgName,
      orgCode: m.orgCode,
      role: m.role,
      isActive: m.isActive,
    })),
    activeOrgId: session.activeOrg?.id ?? null,
    // Display-only capability hints for the active office. Resolved
    // server-side from the active membership's role; excludes protected
    // system actions (e.g. ownership.transfer is never a grantable capability).
    // Empty for an office-less (no active membership) session.
    capabilities:
      session.profile && session.activeRole
        ? resolveCapabilities(session as FullSession)
        : [],
  });
});
