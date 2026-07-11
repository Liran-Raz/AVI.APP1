import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";
import type { Message } from "@/server/db/domain.types";

// Messages repository (Stage 13 R5) — the only place that reads/writes the
// `messages` table. Every query filters org_id explicitly (defense in depth on
// top of RLS). Requires migration 0023.

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

// Office-group feed (recipient_id IS NULL). Without `after`, returns the most
// recent `limit` messages (newest-first); with `after`, returns messages newer
// than it (oldest-first). The service normalizes to display order.
export async function findGroup(
  orgId: string,
  opts: ListOptions,
): Promise<Message[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("messages")
    .select("*")
    .eq("org_id", orgId)
    .is("recipient_id", null);

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

// 1:1 DM thread between two users (both directions), within an org. userA / userB
// are validated uuids (no injection). Same ordering contract as findGroup.
export async function findThread(
  orgId: string,
  userA: string,
  userB: string,
  opts: ListOptions,
): Promise<Message[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("messages")
    .select("*")
    .eq("org_id", orgId)
    .or(
      `and(sender_id.eq.${userA},recipient_id.eq.${userB}),and(sender_id.eq.${userB},recipient_id.eq.${userA})`,
    );

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
