import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";
import type { Organization } from "@/server/db/domain.types";

// Organization repository — only place that talks to `organizations`.

type OrganizationUpdate = Database["public"]["Tables"]["organizations"]["Update"];

export async function findById(orgId: string): Promise<Organization | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();
  return (data as unknown as Organization | null) ?? null;
}

// Batch read. RLS returns only the orgs the caller is an active member
// of, so passing a superset of ids is safe — the result is the visible
// subset. Used by the session builder to resolve the orgs behind a
// user's active memberships in one round-trip.
export async function findByIds(ids: string[]): Promise<Organization[]> {
  if (ids.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organizations")
    .select("*")
    .in("id", ids);
  return (data as unknown as Organization[]) ?? [];
}

// Update office details. The write relies on the RLS policy
// "owner can update own org" (0003/0009), so a non-owner update returns no
// row (→ null). The SERVICE gates owner explicitly too and restricts `patch`
// to editable columns (name / email / phone / address) — org_code is never
// passed here.
export async function update(
  orgId: string,
  patch: OrganizationUpdate,
): Promise<Organization | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .update(patch as never)
    .eq("id", orgId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Organization | null) ?? null;
}
