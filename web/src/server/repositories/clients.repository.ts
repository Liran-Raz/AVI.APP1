import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";
import type {
  BusinessType,
  Client,
} from "@/server/db/domain.types";

// Clients repository — the only place outside the supabase client factory
// that knows how `clients` rows are read or written. Every query filters
// org_id explicitly even though RLS would already enforce the boundary —
// defense in depth (RLS + repo filter + service uses session.organization.id).
//
// Future migration target: replace the supabase calls below with
// pg/Drizzle/Kysely against Cloud SQL. The function signatures stay.

type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

export type ListClientsOptions = {
  search?: string;
  businessType?: BusinessType;
  status: "active" | "archived" | "all";
  limit: number;
  offset: number;
};

export async function findManyByOrgId(
  orgId: string,
  opts: ListClientsOptions,
): Promise<Client[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("clients")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });

  if (opts.status === "active") {
    query = query.eq("is_active", true);
  } else if (opts.status === "archived") {
    query = query.eq("is_active", false);
  }
  // "all" — no filter on is_active

  if (opts.businessType) {
    query = query.eq("business_type", opts.businessType);
  }

  if (opts.search) {
    // Search across name, tax_id, email, phone. Term was already sanitized
    // by the validator so it's safe to interpolate into the PostgREST .or()
    // syntax (no commas, parens, quotes, or LIKE wildcards).
    const term = opts.search;
    query = query.or(
      `name.ilike.%${term}%,tax_id.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`,
    );
  }

  query = query.range(opts.offset, opts.offset + opts.limit - 1);

  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as Client[]) ?? [];
}

export async function findByIdAndOrgId(
  id: string,
  orgId: string,
): Promise<Client | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Client | null) ?? null;
}

export async function create(input: ClientInsert): Promise<Client> {
  const supabase = await createSupabaseServerClient();
  // supabase-js infers Insert as `never` for our hand-written Database type,
  // so we feed it through a `unknown` cast. The schema guard is the
  // ClientInsert type at the call site.
  const { data, error } = await supabase
    .from("clients")
    .insert(input as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Client;
}

export async function updateByIdAndOrgId(
  id: string,
  orgId: string,
  patch: ClientUpdate,
): Promise<Client | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .update(patch as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Client | null) ?? null;
}

export async function setActiveStatus(
  id: string,
  orgId: string,
  isActive: boolean,
): Promise<Client | null> {
  return updateByIdAndOrgId(id, orgId, { is_active: isActive });
}
