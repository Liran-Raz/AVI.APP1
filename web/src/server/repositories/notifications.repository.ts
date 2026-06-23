import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Notification } from "@/server/db/domain.types";

// Notifications repository. RLS isolates by user_id automatically, but
// every method still filters explicitly — defense in depth and
// migration-readiness (if RLS goes away, the app keeps the boundary).

export type ListNotificationsOptions = {
  unreadOnly: boolean;
  limit: number;
};

export async function findManyByUserId(
  userId: string,
  opts: ListNotificationsOptions,
): Promise<Notification[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(opts.limit);
  if (opts.unreadOnly) {
    query = query.is("read_at", null);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as Notification[]) ?? [];
}

export async function countUnreadByUserId(userId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function markRead(
  id: string,
  userId: string,
): Promise<Notification | null> {
  const supabase = await createSupabaseServerClient();
  // Only flip read_at if it is currently NULL — idempotent and avoids
  // overwriting an older read timestamp.
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("user_id", userId)
    .is("read_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Notification | null) ?? null;
}

export async function markAllRead(userId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("notifications")
    .update(
      { read_at: new Date().toISOString() } as never,
      { count: "exact" },
    )
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (error) throw error;
  return count ?? 0;
}
