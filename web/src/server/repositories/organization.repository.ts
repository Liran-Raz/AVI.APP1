import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Organization } from "@/server/db/domain.types";

// Organization repository — only place that talks to `organizations`.

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
