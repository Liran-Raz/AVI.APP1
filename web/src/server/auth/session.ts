import "server-only";

import { authAdapter } from "@/server/auth/supabase-auth.adapter";
import type { AuthUser } from "@/server/auth/auth.adapter";
import { UnauthorizedError } from "@/server/errors/app-error";
import * as profileRepo from "@/server/repositories/profile.repository";
import * as organizationRepo from "@/server/repositories/organization.repository";
import type {
  Organization,
  Profile,
  UserRole,
} from "@/server/db/database.types";

// One session model the rest of the code can rely on.
//   user        — always present after authentication
//   profile     — present only after onboarding has completed
//   organization — present when profile is present
export type Session = {
  user: AuthUser;
  profile: Profile | null;
  organization: Organization | null;
};

export type FullSession = Session & {
  profile: Profile;
  organization: Organization;
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

  const profile = await profileRepo.findByUserId(user.id);
  if (!profile) {
    return { user, profile: null, organization: null };
  }

  const organization = await organizationRepo.findById(profile.org_id);
  return { user, profile, organization };
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
  if (!session.profile || !session.organization) {
    // Authenticated but onboarding incomplete. API callers can treat
    // this as a 401 and send the user to /onboarding. Server Components
    // should prefer getCurrentSession() and redirect explicitly.
    throw new UnauthorizedError("Onboarding required");
  }
  return session as FullSession;
}

export async function requireRole(role: UserRole | UserRole[]): Promise<FullSession> {
  const session = await requireSession();
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(session.profile.role)) {
    throw new UnauthorizedError("Insufficient role");
  }
  return session;
}
