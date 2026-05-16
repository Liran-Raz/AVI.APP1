import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Organization, Profile } from "@/lib/types/database";

/**
 * Get the current authenticated user's profile + organization.
 * Returns null if unauthenticated or profile missing.
 */
export async function getCurrentUser(): Promise<
  { profile: Profile; organization: Organization } | null
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  const { data: organization } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profile.org_id)
    .single();
  if (!organization) return null;

  return { profile, organization };
}
