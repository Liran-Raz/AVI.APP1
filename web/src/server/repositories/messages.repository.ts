import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";
import type { Message } from "@/server/db/domain.types";

// Messages repository — the only place that reads/writes the `messages` table.
// Every query filters org_id explicitly (defense in depth on top of RLS).
// Stage 14 (migration 0024): messages are addressed by conversation_id.

type MessageInsert = Database["public"]["Tables"]["messages"]["Insert"];

type ListOptions = {
  after?: string; // ISO timestamp — return only messages strictly newer
  limit: number;
};

export async function create(input: MessageInsert): Promise<Message> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("messages")
    .insert(input as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Message;
}

// All messages in a conversation. Without `after`, returns the most recent
// `limit` messages (newest-first); with `after`, returns messages at/after it
// (oldest-first). The service normalizes to display order. RLS restricts rows to
// conversations the caller can read; org_id is filtered explicitly too.
export async function findByConversation(
  orgId: string,
  conversationId: string,
  opts: ListOptions,
): Promise<Message[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("messages")
    .select("*")
    .eq("org_id", orgId)
    .eq("conversation_id", conversationId);

  if (opts.after) {
    // gte (not gt): a message committed with the SAME created_at as the cursor
    // would otherwise be dropped forever. The client dedups by id (mergeNew),
    // so re-fetching the boundary row is harmless.
    query = query.gte("created_at", opts.after).order("created_at", { ascending: true });
  } else {
    query = query.order("created_at", { ascending: false });
  }
  query = query.limit(opts.limit);

  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as Message[]) ?? [];
}

// Edit a message body (Stage 14 / R4). RLS enforces sender + ≤10-minute window +
// membership; a disallowed edit updates 0 rows → returns null (not an error).
export async function updateBody(
  id: string,
  orgId: string,
  body: string,
): Promise<Message | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("messages")
    .update({ body, edited_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Message | null) ?? null;
}

// Soft-delete a message (Stage 14 / R4) — tombstone via deleted_at; the body is
// blanked so deleted content doesn't linger. RLS enforces sender + window +
// membership; disallowed → 0 rows → null. Row is never hard-deleted (revoked).
export async function softDelete(
  id: string,
  orgId: string,
): Promise<Message | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("messages")
    .update({ body: "", deleted_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Message | null) ?? null;
}
