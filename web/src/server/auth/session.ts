import "server-only";

import { authAdapter } from "@/server/auth/supabase-auth.adapter";
import type { AuthUser } from "@/server/auth/auth.adapter";
import { createSupabaseServerClient } from "@/server/db/supabase";
import { UnauthorizedError } from "@/server/errors/app-error";
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

  const supabase = await createSupabaseServerClient();

  // Repository layer will replace these direct queries in Round 3.
  // The `as` casts work around supabase-js inference falling back to `never`
  // for our hand-written Database type; can be removed once we switch to
  // generated types or move to the repository layer.
  const profileResult = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileResult.data as Profile | null;

  if (!profile) {
    return { user, profile: null, organization: null };
  }

  const orgResult = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profile.org_id)
    .maybeSingle();
  const organization = orgResult.data as Organization | null;

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
    // Authenticated but onboarding incomplete. Callers in API contexts
    // can treat this as a 401 and let the client send the user to
    // /onboarding. Server Components should prefer getCurrentSession()
    // and redirect("/onboarding") explicitly.
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
