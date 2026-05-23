import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Profile, UserRole } from "@/server/db/database.types";

// Team repository — `profiles` access scoped to a single org.
// Returns Profile rows; the service is responsible for DTO mapping.

export async function findMembersByOrgId(orgId: string): Promise<Profile[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  return (data as unknown as Profile[]) ?? [];
}

export async function findById(profileId: string): Promise<Profile | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .maybeSingle();
  return (data as unknown as Profile | null) ?? null;
}

export async function findByEmailInOrg(
  orgId: string,
  email: string,
): Promise<Profile | null> {
  const supabase = await createSupabaseServerClient();
  // Lower-case both sides for safety; Supabase Auth stores normalized
  // emails but profile.email could in principle drift.
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("org_id", orgId)
    .ilike("email", email)
    .maybeSingle();
  return (data as unknown as Profile | null) ?? null;
}

export async function countActiveOwners(orgId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "owner")
    .eq("is_active", true);
  return count ?? 0;
}

export async function updateRole(
  profileId: string,
  orgId: string,
  role: UserRole,
): Promise<Profile> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", profileId)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Profile;
}

export async function setActive(
  profileId: string,
  orgId: string,
  isActive: boolean,
): Promise<Profile> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", profileId)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Profile;
}
