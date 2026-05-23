import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type {
  Invitation,
  InvitationStatus,
  UserRole,
} from "@/server/db/database.types";

// Invitations repository — only place that talks to `invitations`.

export type CreateInvitationInput = {
  org_id: string;
  email: string;
  role: UserRole;
  token_hash: string;
  expires_at: string;
  invited_by: string;
};

export async function create(input: CreateInvitationInput): Promise<Invitation> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invitations")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Invitation;
}

// Find a pending invitation by raw token hash in a specific org.
// Used to detect duplicate pending invites before insert.
export async function findPendingByEmailInOrg(
  orgId: string,
  email: string,
): Promise<Invitation | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("invitations")
    .select("*")
    .eq("org_id", orgId)
    .ilike("email", email)
    .eq("status", "pending")
    .maybeSingle();
  return (data as unknown as Invitation | null) ?? null;
}

// Find invitation by token hash. Used by the public lookup that the
// /invite/accept and /invite/signup pages do (server-side) to render
// "you've been invited to <org> as <role>".
//
// Returns the invitation regardless of status so the caller can show
// the right error. The accept RPC re-validates server-side.
export async function findByTokenHash(
  tokenHash: string,
): Promise<Invitation | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("invitations")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  return (data as unknown as Invitation | null) ?? null;
}

export async function setStatus(
  id: string,
  orgId: string,
  status: InvitationStatus,
): Promise<Invitation> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invitations")
    .update({ status })
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Invitation;
}
