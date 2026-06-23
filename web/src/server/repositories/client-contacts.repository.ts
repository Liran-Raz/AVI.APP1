import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";
import type { ClientContact } from "@/server/db/domain.types";

// Client contacts repository — talks to public.client_contacts.
//
// The table has no org_id column; org isolation goes through the
// parent client. The service layer is responsible for verifying that
// the parent clientId belongs to the caller's org BEFORE calling these
// methods. RLS also enforces it via an EXISTS subquery on clients.

type ContactInsert = Database["public"]["Tables"]["client_contacts"]["Insert"];
type ContactUpdate = Database["public"]["Tables"]["client_contacts"]["Update"];

export async function findManyByClientId(
  clientId: string,
): Promise<ClientContact[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_contacts")
    .select("*")
    .eq("client_id", clientId)
    // Primary contact first, then by name.
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data as unknown as ClientContact[]) ?? [];
}

export async function findByIdAndClientId(
  id: string,
  clientId: string,
): Promise<ClientContact | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_contacts")
    .select("*")
    .eq("id", id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ClientContact | null) ?? null;
}

export async function create(input: ContactInsert): Promise<ClientContact> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_contacts")
    .insert(input as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as ClientContact;
}

export async function updateByIdAndClientId(
  id: string,
  clientId: string,
  patch: ContactUpdate,
): Promise<ClientContact | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_contacts")
    .update(patch as never)
    .eq("id", id)
    .eq("client_id", clientId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ClientContact | null) ?? null;
}

export async function deleteByIdAndClientId(
  id: string,
  clientId: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("client_contacts")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("client_id", clientId);
  if (error) throw error;
  return (count ?? 0) > 0;
}
