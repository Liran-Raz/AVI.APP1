import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { UserRole } from "@/server/db/domain.types";

// Team repository — reads the team roster for an org from the AUTHORITATIVE
// organization_memberships table, joined to `profiles` for identity
// (name / email). Role + active-status come from the membership, NOT from
// the legacy profiles columns.
//
// Membership mutations (role change, deactivation, owner counting) live
// in memberships.repository.ts. This file only does the join-shaped reads
// the team UI needs.

// A row in the team roster: the user's identity plus their per-org
// role/active state. `userId` === profiles.id === auth.users.id.
export type TeamMemberRow = {
  userId: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  joinedAt: string;
  // Owner-granted dashboard access (Stage 13 R4). Owners always have it.
  dashboardAccess: boolean;
};

type MembershipLite = {
  user_id: string;
  role: UserRole;
  is_active: boolean;
  joined_at: string;
  dashboard_access: boolean;
};

type ProfileLite = {
  id: string;
  full_name: string;
  email: string;
};

// All members of an org, ordered by join time. Two reads (memberships,
// then profiles) zipped on user_id — avoids PostgREST embeds so the
// hand-written Database types stay simple.
export async function findMembersByOrgId(
  orgId: string,
): Promise<TeamMemberRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data: membershipData } = await supabase
    .from("organization_memberships")
    .select("user_id, role, is_active, joined_at, dashboard_access")
    .eq("org_id", orgId)
    .order("joined_at", { ascending: true });

  const memberships = (membershipData as unknown as MembershipLite[]) ?? [];
  if (memberships.length === 0) return [];

  const userIds = memberships.map((m) => m.user_id);
  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds);

  const profiles = (profileData as unknown as ProfileLite[]) ?? [];
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  return memberships.map((m) => {
    const p = profileById.get(m.user_id);
    return {
      userId: m.user_id,
      fullName: p?.full_name ?? "",
      email: p?.email ?? "",
      role: m.role,
      isActive: m.is_active,
      joinedAt: m.joined_at,
      dashboardAccess: m.dashboard_access === true,
    };
  });
}

// A single member of an org (identity + per-org role/active), or null if
// the user has no membership in this org. Used for target lookups and to
// shape the DTO returned after a role change / deactivation.
export async function findMemberInOrg(
  orgId: string,
  userId: string,
): Promise<TeamMemberRow | null> {
  const supabase = await createSupabaseServerClient();

  const { data: membershipRow } = await supabase
    .from("organization_memberships")
    .select("user_id, role, is_active, joined_at, dashboard_access")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  const membership = membershipRow as unknown as MembershipLite | null;
  if (!membership) return null;

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", userId)
    .maybeSingle();

  const profile = profileRow as unknown as ProfileLite | null;

  return {
    userId,
    fullName: profile?.full_name ?? "",
    email: profile?.email ?? "",
    role: membership.role,
    isActive: membership.is_active,
    joinedAt: membership.joined_at,
    dashboardAccess: membership.dashboard_access === true,
  };
}

// Is this email already a member of this org? Returns the membership's
// active state when found. RLS restricts the profile lookup to co-members,
// so an email that belongs to nobody in any of the caller's orgs simply
// returns null (treated as "not a member" — the invite can proceed).
export async function findMemberByEmailInOrg(
  orgId: string,
  email: string,
): Promise<{ userId: string; isActive: boolean } | null> {
  const supabase = await createSupabaseServerClient();

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  const profile = profileRow as unknown as { id: string } | null;
  if (!profile) return null;

  const { data: membershipRow } = await supabase
    .from("organization_memberships")
    .select("is_active")
    .eq("user_id", profile.id)
    .eq("org_id", orgId)
    .maybeSingle();

  const membership = membershipRow as unknown as { is_active: boolean } | null;
  if (!membership) return null;

  return { userId: profile.id, isActive: membership.is_active };
}
