import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Organization } from "@/server/db/database.types";

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
