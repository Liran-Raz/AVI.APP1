import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type {
  OrganizationMembership,
  UserRole,
} from "@/server/db/domain.types";

// Memberships repository — the only place that talks to
// `organization_memberships`. This table is the AUTHORITATIVE source of
// a user's role + active-status in a given org (profiles.role/is_active
// are legacy shadow fields after migration 0009).
//
// Two-query joins (membership then organizations/profiles) are used
// elsewhere rather than PostgREST embeds, to keep the hand-written
// Database types simple and match the rest of the repo layer.

// All memberships for a user, ordered by join time (stable order for
// picking a deterministic default active org).
export async function findByUserId(
  userId: string,
): Promise<OrganizationMembership[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organization_memberships")
    .select("*")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });
  return (data as unknown as OrganizationMembership[]) ?? [];
}

// A single membership for (user, org), or null. Used to validate an
// active-org switch and to inspect a target member's per-org role.
export async function findByUserAndOrg(
  userId: string,
  orgId: string,
): Promise<OrganizationMembership | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organization_memberships")
    .select("*")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();
  return (data as unknown as OrganizationMembership | null) ?? null;
}

// Members of an org (membership rows only — caller joins profiles for
// identity). Ordered by join time so the team list is stable.
export async function findByOrgId(
  orgId: string,
): Promise<OrganizationMembership[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organization_memberships")
    .select("*")
    .eq("org_id", orgId)
    .order("joined_at", { ascending: true });
  return (data as unknown as OrganizationMembership[]) ?? [];
}

export async function countActiveOwners(orgId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("organization_memberships")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "owner")
    .eq("is_active", true);
  return count ?? 0;
}

export async function updateRole(
  userId: string,
  orgId: string,
  role: UserRole,
): Promise<OrganizationMembership> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_memberships")
    .update({ role })
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as OrganizationMembership;
}

export async function setActive(
  userId: string,
  orgId: string,
  isActive: boolean,
): Promise<OrganizationMembership> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_memberships")
    .update({ is_active: isActive })
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as OrganizationMembership;
}
