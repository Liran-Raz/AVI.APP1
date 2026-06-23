import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Profile } from "@/server/db/domain.types";

// Profile repository — the only place outside the supabase client
// factory that knows how `profiles` rows are read or written.
//
// Future migration target: replace the supabase calls below with
// pg/Drizzle/Kysely against Cloud SQL. Callers (session.ts, services)
// don't change.

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
