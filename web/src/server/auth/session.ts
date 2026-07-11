import "server-only";

import { authAdapter } from "@/server/auth/supabase-auth.adapter";
import type { AuthUser } from "@/server/auth/auth.adapter";
import { readActiveOrgCookie } from "@/server/auth/active-org-cookie";
import { UnauthorizedError } from "@/server/errors/app-error";
import * as profileRepo from "@/server/repositories/profile.repository";
import * as organizationRepo from "@/server/repositories/organization.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import type {
  Organization,
  Profile,
  UserRole,
} from "@/server/db/domain.types";
import type { GrantMap } from "@/server/auth/permission-grants";
import {
  authoritativeGrantMap,
  emitShadowParityFromResult,
  fireShadowParity,
  isDbRoleAuthoritativeEnabled,
  isDbRoleShadowEnabled,
  logAuthoritativeResolutionFailure,
  resolveDbRoleGrants,
} from "@/server/auth/db-role-resolver";

// One membership the session exposes. Org name/code are denormalized for
// the office switcher UI. Only ACTIVE, visible memberships appear here.
export type Membership = {
  orgId: string;
  orgName: string;
  orgCode: string;
  role: UserRole;
  isActive: boolean;
  // Owner-granted access to the management dashboard (Stage 13 R4). Owners
  // always have access regardless of this flag; it governs non-owners.
  dashboardAccess: boolean;
};

// The session model the rest of the code relies on.
//
//   user         — always present after authentication
//   profile      — present only after onboarding (a profile row exists).
//                  NOTE: role / is_active / org_id on this object are
//                  OVERLAID from the ACTIVE membership, so existing code
//                  that reads `session.profile.role` keeps working and
//                  reflects the per-org role. The persisted profiles
//                  columns are legacy shadows and are NOT what you read
//                  here.
//   organization — ALIAS for `activeOrg` (kept for backward compat with
//                  all the PR #1–#9 code that reads session.organization).
//   memberships  — every active office the user belongs to (for the
//                  office switcher).
//   activeOrg    — the office currently in scope (validated per request).
//   activeRole   — the user's role IN the active office.
export type Session = {
  user: AuthUser;
  profile: Profile | null;
  organization: Organization | null;
  memberships: Membership[];
  activeOrg: Organization | null;
  activeRole: UserRole | null;
  // CUTOVER (Phase 8J): DB-resolved grant map. Present whenever the
  // DB_ROLE_AUTHORITATIVE flag is ON — set to the resolved grants on success, and
  // to {} (DENY-ALL) on ANY resolution failure (fail-closed; NEVER the legacy
  // map). When the flag is OFF it stays undefined and the engine falls back to
  // the in-code ROLE_GRANTS map.
  grantMap?: GrantMap;
};

export type FullSession = Session & {
  profile: Profile;
  organization: Organization;
  activeOrg: Organization;
  activeRole: UserRole;
};

// ============================================================
// Non-throwing readers — use in Server Components where the caller
// decides what to do (redirect / render alternate UI / etc.).
// ============================================================

export async function getCurrentUser(): Promise<AuthUser | null> {
  return authAdapter.getCurrentUser();
}

export async function getCurrentSession(): Promise<Session | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const [profile, allMemberships] = await Promise.all([
    profileRepo.findByUserId(user.id),
    membershipsRepo.findByUserId(user.id),
  ]);

  // Resolve the orgs behind the user's ACTIVE memberships. RLS returns
  // only the orgs the user is an active member of, so this is also a
  // visibility filter.
  const activeRows = allMemberships.filter((m) => m.is_active);
  const orgs = await organizationRepo.findByIds(activeRows.map((m) => m.org_id));
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  const memberships: Membership[] = activeRows
    .map((m): Membership | null => {
      const org = orgById.get(m.org_id);
      if (!org) return null;
      return {
        orgId: org.id,
        orgName: org.name,
        orgCode: org.org_code,
        role: m.role,
        isActive: m.is_active,
        // Defensive read: the column may be absent at runtime before migration
        // 0022 is applied (findByUserId uses select *), so undefined → false.
        dashboardAccess: m.dashboard_access === true,
      };
    })
    .filter((m): m is Membership => m !== null);

  // Office-less: authenticated but no profile yet, or no active office.
  // Callers treat this like the old "onboarding incomplete" state.
  if (!profile || memberships.length === 0) {
    return {
      user,
      profile: profile ?? null,
      organization: null,
      memberships,
      activeOrg: null,
      activeRole: null,
    };
  }

  // Pick the active office: the cookie's org if it is a valid active
  // membership, otherwise the first one (deterministic join order). We do
  // NOT write the cookie here — getCurrentSession runs during Server
  // Component render where cookie writes are disallowed. The switch
  // endpoint and the invite-accept route are the authoritative writers;
  // the fallback keeps single-office users working with no cookie at all.
  let chosen = memberships[0];
  const cookieOrgId = await readActiveOrgCookie();
  if (cookieOrgId) {
    const fromCookie = memberships.find((m) => m.orgId === cookieOrgId);
    if (fromCookie) chosen = fromCookie;
  }

  const activeOrg = orgById.get(chosen.orgId) as Organization;
  const activeRole = chosen.role;

  // Overlay the legacy fields from the ACTIVE membership so that every
  // existing service reading session.profile.role / org_id sees the
  // per-org truth without having to change.
  const overlaidProfile: Profile = {
    ...profile,
    org_id: activeOrg.id,
    role: activeRole,
    is_active: true,
  };

  const fullSession: Session = {
    user,
    profile: overlaidProfile,
    organization: activeOrg,
    memberships,
    activeOrg,
    activeRole,
  };

  // CUTOVER (Phase 8J; flag-gated, OFF by default) + SHADOW (Phase 8H).
  //   * Authoritative ON: resolve the DB grant map and attach it. FAIL-CLOSED —
  //     on ANY resolver failure the map is DENY-ALL ({}) (see authoritativeGrantMap),
  //     NEVER the legacy code map. A failure is logged (PII-free). The engine then
  //     reads grantMap for every decision.
  //   * Shadow ON: observational only; never authoritative. When BOTH are on, the
  //     single resolved result is REUSED for parity (no second RPC).
  //   * Both OFF (default): no RPC; behavior identical to today.
  if (isDbRoleAuthoritativeEnabled()) {
    const resolved = await resolveDbRoleGrants(fullSession as FullSession);
    fullSession.grantMap = authoritativeGrantMap(resolved);
    if (!resolved.ok) {
      logAuthoritativeResolutionFailure(fullSession as FullSession, resolved.reason);
    }
    if (isDbRoleShadowEnabled()) {
      emitShadowParityFromResult(fullSession as FullSession, resolved);
    }
  } else if (isDbRoleShadowEnabled()) {
    // Fire-and-forget; never blocks the request.
    void fireShadowParity(fullSession as FullSession);
  }

  return fullSession;
}

// ============================================================
// Throwing assertions — use in API routes and server actions where
// withErrorHandler will translate failures into 401/403 responses.
// ============================================================

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requireSession(): Promise<FullSession> {
  const session = await getCurrentSession();
  if (!session) throw new UnauthorizedError();
  if (!session.profile || !session.activeOrg || !session.activeRole) {
    // Authenticated but no active office (onboarding incomplete, or the
    // user has been deactivated from every office). API callers treat
    // this as 401; Server Components prefer getCurrentSession() and
    // redirect explicitly.
    throw new UnauthorizedError("Onboarding required");
  }
  return session as FullSession;
}

export async function requireRole(
  role: UserRole | UserRole[],
): Promise<FullSession> {
  const session = await requireSession();
  const allowed = Array.isArray(role) ? role : [role];
  // activeRole is the role IN the active office (per-org).
  if (!allowed.includes(session.activeRole)) {
    throw new UnauthorizedError("Insufficient role");
  }
  return session;
}
