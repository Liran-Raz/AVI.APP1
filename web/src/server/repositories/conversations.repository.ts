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

// ---------------------------------------------------------------------------
// Stage 14 / R2 — group conversations. Reads are RLS-gated (participant-only for
// groups); every WRITE goes through a SECURITY DEFINER RPC (0024 create + 0025
// manage) — the client has no direct write grant on conversations/participants
// (fail-closed). Every read still filters org_id explicitly (defense in depth).
// ---------------------------------------------------------------------------

export type ParticipantRow = {
  conversation_id: string;
  user_id: string;
  is_admin: boolean;
  joined_at: string;
};

// My ACTIVE group memberships in this org: the conversation id + whether I'm its
// admin. (RLS lets me read my own participant rows.)
export async function listMyGroupParticipations(
  orgId: string,
  userId: string,
): Promise<{ conversationId: string; isAdmin: boolean }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("conversation_id, is_admin")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .is("left_at", null);
  if (error) throw error;
  const rows =
    (data as unknown as { conversation_id: string; is_admin: boolean }[]) ?? [];
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    isAdmin: r.is_admin === true,
  }));
}

// Live (non-deleted) GROUP conversations by id, scoped to the org. RLS additionally
// restricts to conversations the caller participates in.
export async function findGroupsByIds(
  orgId: string,
  ids: string[],
): Promise<Conversation[]> {
  if (ids.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("org_id", orgId)
    .eq("kind", "group")
    .is("deleted_at", null)
    .in("id", ids);
  if (error) throw error;
  return (data as unknown as Conversation[]) ?? [];
}

// A single live GROUP conversation (RLS: participant-only). Null when it doesn't
// exist, is deleted, isn't a group, or the caller isn't a participant.
export async function getGroupById(
  orgId: string,
  convId: string,
): Promise<Conversation | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", convId)
    .eq("kind", "group")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Conversation | null) ?? null;
}

// Active participants of the given conversations (RLS: only conversations the
// caller is in). Ordered by join time. Used for member lists + counts.
export async function listActiveParticipants(
  convIds: string[],
): Promise<ParticipantRow[]> {
  if (convIds.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("conversation_id, user_id, is_admin, joined_at")
    .in("conversation_id", convIds)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as ParticipantRow[]) ?? [];
}

// ----- WRITES: SECURITY DEFINER RPCs. The client has no direct write grant. -----

// Create a group (creator becomes admin; non-member/self ids are ignored in the
// RPC). Returns the new conversation id.
export async function createGroup(
  orgId: string,
  title: string,
  memberIds: string[],
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_group_conversation", {
    p_org_id: orgId,
    p_title: title,
    p_member_ids: memberIds,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function renameGroup(convId: string, title: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("rename_group_conversation", {
    p_conv_id: convId,
    p_title: title,
  });
  if (error) throw error;
}

export async function addMember(convId: string, userId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_group_member", {
    p_conv_id: convId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function removeMember(convId: string, userId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_group_member", {
    p_conv_id: convId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function leaveGroup(convId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("leave_group_conversation", {
    p_conv_id: convId,
  });
  if (error) throw error;
}

export async function deleteGroup(convId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_group_conversation", {
    p_conv_id: convId,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Stage 14 / R3 — read state. mark-read is a SECURITY DEFINER RPC (fail-closed:
// the client has no direct write on last_read_at). Reads are RLS-gated.
// ---------------------------------------------------------------------------

// Set the caller's last_read_at for a conversation (office row created lazily;
// dm/group require an existing active participant row). Fail-closed via the RPC.
export async function markRead(convId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conversation_id: convId,
  });
  if (error) throw error;
}

export type UnreadCountRow = {
  conversation_id: string;
  kind: "office" | "dm" | "group";
  dm_key: string | null;
  unread: number;
};

// The caller's unread count per conversation (SECURITY DEFINER, scoped to auth.uid()).
export async function getUnreadCounts(): Promise<UnreadCountRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_unread_counts");
  if (error) throw error;
  return (data as unknown as UnreadCountRow[]) ?? [];
}

// The active participants of a conversation with their read cursor (last_read_at).
// RLS restricts this to conversations the caller is in. Used for ✓/✓✓ + "read by".
export async function listReadState(
  orgId: string,
  convId: string,
): Promise<{ user_id: string; last_read_at: string | null }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("user_id, last_read_at")
    .eq("org_id", orgId)
    .eq("conversation_id", convId)
    .is("left_at", null);
  if (error) throw error;
  return (
    (data as unknown as { user_id: string; last_read_at: string | null }[]) ?? []
  );
}
