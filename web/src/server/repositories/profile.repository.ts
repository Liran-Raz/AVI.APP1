import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";
import type { Profile } from "@/server/db/domain.types";

// Profile repository — the only place outside the supabase client
// factory that knows how `profiles` rows are read or written.
//
// Future migration target: replace the supabase calls below with
// pg/Drizzle/Kysely against Cloud SQL. Callers (session.ts, services)
// don't change.

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

export async function findByUserId(userId: string): Promise<Profile | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  // supabase-js inference falls back to `never` for our hand-written
  // Database type; cast through unknown to be explicit.
  return (data as unknown as Profile | null) ?? null;
}

// Self-update of the caller's OWN profile row. The write path relies on the
// RLS policy "users update own profile" (0009 migration) which permits
// `update ... using (id = auth.uid())`. The SERVICE restricts `patch` to
// safe columns (full_name / phone) — this repo does not police columns, so
// never pass role / org_id / is_active here.
export async function updateOwnProfile(
  userId: string,
  patch: ProfileUpdate,
): Promise<Profile | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .update(patch as never)
    .eq("id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Profile | null) ?? null;
}
