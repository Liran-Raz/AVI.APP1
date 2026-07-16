import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";
import type { Ledger } from "@/server/db/domain.types";

// Ledgers repository (DEV-026 R1) — the only place that reads/writes `ledgers`
// rows. Every query filters org_id explicitly even though RLS already enforces
// the boundary — defense in depth (RLS + repo filter + service injects
// session.organization.id).
//
// Stage A: exactly one self-ledger per org (is_self = true, seeded by 0027).
// Stage B will add client-owned ledgers; the signatures below already carry
// the generic byIdAndOrgId shape so nothing needs to change.

type LedgerUpdate = Database["public"]["Tables"]["ledgers"]["Update"];

export async function findManyByOrgId(orgId: string): Promise<Ledger[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ledgers")
    .select("*")
    .eq("org_id", orgId)
    .order("is_self", { ascending: false })
    .order("legal_name", { ascending: true });
  if (error) throw error;
  return (data as unknown as Ledger[]) ?? [];
}

export async function findSelfByOrgId(orgId: string): Promise<Ledger | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ledgers")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_self", true)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Ledger | null) ?? null;
}

export async function findByIdAndOrgId(
  id: string,
  orgId: string,
): Promise<Ledger | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ledgers")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Ledger | null) ?? null;
}

export async function updateByIdAndOrgId(
  id: string,
  orgId: string,
  patch: LedgerUpdate,
): Promise<Ledger | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ledgers")
    .update(patch as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Ledger | null) ?? null;
}
