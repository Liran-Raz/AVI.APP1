import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Conversation } from "@/server/db/domain.types";

// Conversations repository (Stage 14 / R1) — the only place that reads/writes the
// `conversations` table. Every query filters org_id explicitly (defense in depth
// on top of RLS). Requires migration 0024.

// Deterministic DM key: the two participant ids, LOWERCASED, lexicographically
// sorted, joined by ':'. Mirrors the SQL least(a,b)::text || ':' || greatest(a,b)::text
// (uuid::text is always lowercase; the toLowerCase keeps JS↔SQL parity even if a
// non-canonical/uppercase id ever reaches this path). Exported for a parity test.
export function dmKey(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join(":");
}

// The single office conversation for an org (one per org). Read-only.
export async function findOffice(orgId: string): Promise<Conversation | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("org_id", orgId)
    .eq("kind", "office")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Conversation | null) ?? null;
}

// Get-or-create the office conversation via the SECURITY DEFINER RPC. The client
// has NO direct write grant on `conversations` (fail-closed model — all writes go
// through validated definer functions). Returns the office conversation id.
export async function ensureOffice(orgId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ensure_office_conversation", {
    p_org_id: orgId,
  });
  if (error) throw error;
  return data as unknown as string;
}

// Read-only lookup of a 1:1 DM conversation by the unordered {a,b} pair. Returns
// null when the two have never messaged (so merely OPENING a DM never creates a row).
export async function findDm(
  orgId: string,
  userA: string,
  userB: string,
): Promise<Conversation | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("org_id", orgId)
    .eq("kind", "dm")
    .eq("dm_key", dmKey(userA, userB))
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Conversation | null) ?? null;
}

// Get-or-create a DM conversation with a colleague, inserting BOTH participant
// rows atomically. Membership + self-check are validated inside the SECURITY
// DEFINER RPC (the participant rows can't be created under the caller's RLS).
export async function ensureDm(
  orgId: string,
  otherUserId: string,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("ensure_dm_conversation", {
    p_org_id: orgId,
    p_other_user: otherUserId,
  });
  if (error) throw error;
  return data as unknown as string;
}
