import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";

// Health repository — a deliberately tiny DB probe that THROWS.
//
// Not reusing organization.repository.findById here: that reader
// swallows provider errors by design (returns null), which would make
// a real DB outage indistinguishable from "row not visible". The
// topbar connectivity indicator needs the failure to propagate.
export async function pingDb(orgId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}
