import "server-only";

import type { FullSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors/app-error";
import * as messagesRepo from "@/server/repositories/messages.repository";
import * as conversationsRepo from "@/server/repositories/conversations.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import type { Message } from "@/server/db/domain.types";
import {
  parseConversationRef,
  type ListMessagesQuery,
  type SendMessagePayload,
} from "@/server/validators/messages.schema";

// Office chat service. Sends / lists / marks-read a conversation (office, DM, or
// group) + edit/soft-delete (Stage 14 / R4). Multi-tenancy: org_id + sender_id are
// injected from the session (never the client). Reads are RLS-gated; writes to
// last_read_at go only through a SECURITY DEFINER RPC (fail-closed).

export type MessageDTO = {
  id: string;
  body: string;
  senderId: string;
  senderName: string;
  recipientId: string | null;
  createdAt: string;
  editedAt: string | null; // R4: non-null → show "edited"
  deletedAt: string | null; // R4: non-null → tombstone (body blanked)
};

// A recipient's read cursor for the active conversation (R3: ✓/✓✓ + "read by").
export type ReadRecipientDTO = {
  id: string;
  name: string;
  lastReadAt: string | null;
};
export type ReadStateDTO = { recipients: ReadRecipientDTO[] };

export type UnreadCountsDTO = {
  office: number;
  dms: Record<string, number>; // counterpart userId → unread
  groups: Record<string, number>; // conversationId → unread
  total: number;
};

type ConversationKind = "office" | "dm" | "group";

// Load the org roster once; derive a name resolver + the active-member list (the
// latter is the office "read by" recipient set). Falls back to a neutral label.
async function loadRoster(orgId: string) {
  const roster = await teamRepo.findMembersByOrgId(orgId);
  const byId = new Map(roster.map((m) => [m.userId, m.fullName || "—"]));
  const name = (id: string) => byId.get(id) ?? "משתמש";
  return { roster, name };
}

function toDTO(row: Message, name: (id: string) => string): MessageDTO {
  const deleted = row.deleted_at != null;
  return {
    id: row.id,
    body: deleted ? "" : row.body, // never leak deleted content
    senderId: row.sender_id,
    senderName: name(row.sender_id),
    recipientId: row.recipient_id,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  };
}

// A non-null DM recipient must be an ACTIVE member of the caller's org.
async function assertRecipientInOrg(
  session: FullSession,
  recipientId: string,
): Promise<void> {
  const membership = await membershipsRepo.findByUserAndOrg(
    recipientId,
    session.organization.id,
  );
  if (!membership || !membership.is_active) {
    throw new ValidationError("Recipient is not an active member of this organization");
  }
}

// Resolve a `with` address to its conversation id (or null if it doesn't exist
// yet), plus its kind + (for a DM) the counterpart. Shared by list + mark-read.
async function resolveConversation(
  session: FullSession,
  withValue: string,
): Promise<{ conversationId: string | null; kind: ConversationKind; counterpartId: string | null }> {
  const orgId = session.organization.id;
  const groupRef = parseConversationRef(withValue);

  if (withValue === "group") {
    const office = await conversationsRepo.findOffice(orgId);
    return { conversationId: office?.id ?? null, kind: "office", counterpartId: null };
  }
  if (groupRef) {
    // Only a readable (participant) live group resolves; else null → empty (no leak).
    const group = await conversationsRepo.getGroupById(orgId, groupRef);
    return { conversationId: group?.id ?? null, kind: "group", counterpartId: null };
  }
  // DM: the counterpart must be (or have been) a member of THIS org.
  const membership = await membershipsRepo.findByUserAndOrg(withValue, orgId);
  if (!membership) {
    throw new ValidationError("Not a member of this organization");
  }
  // Read-only: merely OPENING a never-messaged DM must not create a row.
  const dm = await conversationsRepo.findDm(orgId, session.user.id, withValue);
  return { conversationId: dm?.id ?? null, kind: "dm", counterpartId: withValue };
}

export async function sendMessage(
  session: FullSession,
  input: SendMessagePayload,
): Promise<MessageDTO> {
  const orgId = session.organization.id;

  // Resolve the target conversation. recipient_id is ALSO populated (office/group
  // = null, dm = recipient) so the legacy indexes + rollback stay consistent (R1).
  let conversationId: string;
  let recipientId: string | null = null;

  if (input.conversationId) {
    // Group message: the target must be a live group the caller participates in
    // (RLS would block the insert regardless; this yields a clean 400, not a 500).
    const group = await conversationsRepo.getGroupById(orgId, input.conversationId);
    if (!group) {
      throw new ValidationError("Group not found or you are not a member");
    }
    conversationId = group.id;
  } else if (input.recipientId) {
    recipientId = input.recipientId;
    if (recipientId === session.user.id) {
      throw new ValidationError("Cannot send a direct message to yourself");
    }
    await assertRecipientInOrg(session, recipientId);
    conversationId = await conversationsRepo.ensureDm(orgId, recipientId);
  } else {
    conversationId = await conversationsRepo.ensureOffice(orgId);
  }

  const row = await messagesRepo.create({
    org_id: orgId,
    sender_id: session.user.id,
    recipient_id: recipientId,
    conversation_id: conversationId,
    body: input.body,
  });

  const { name } = await loadRoster(orgId);
  return toDTO(row, name);
}

// The other participants of a conversation with their read cursor. For office the
// recipient set is the active roster (members without a participant row → never
// read); for group/dm it's the actual participants. Used for ✓/✓✓ + "read by".
async function buildReadState(
  session: FullSession,
  conversationId: string,
  kind: ConversationKind,
  counterpartId: string | null,
  roster: Awaited<ReturnType<typeof loadRoster>>["roster"],
  name: (id: string) => string,
): Promise<ReadStateDTO> {
  const rows = await conversationsRepo.listReadState(
    session.organization.id,
    conversationId,
  );
  const readByUser = new Map(rows.map((r) => [r.user_id, r.last_read_at]));

  let recipientIds: string[];
  if (kind === "dm") {
    recipientIds = counterpartId ? [counterpartId] : [];
  } else if (kind === "group") {
    recipientIds = rows.map((r) => r.user_id).filter((id) => id !== session.user.id);
  } else {
    // office: every active member other than me
    recipientIds = roster
      .filter((m) => m.isActive && m.userId !== session.user.id)
      .map((m) => m.userId);
  }

  return {
    recipients: recipientIds.map((id) => ({
      id,
      name: name(id),
      lastReadAt: readByUser.get(id) ?? null,
    })),
  };
}

export async function listMessages(
  session: FullSession,
  query: ListMessagesQuery,
): Promise<{ items: MessageDTO[]; readState: ReadStateDTO }> {
  const orgId = session.organization.id;
  const opts = { after: query.after, limit: query.limit };

  const { conversationId, kind, counterpartId } = await resolveConversation(
    session,
    query.with,
  );
  const { roster, name } = await loadRoster(orgId);

  if (!conversationId) return { items: [], readState: { recipients: [] } };

  const rows = await messagesRepo.findByConversation(orgId, conversationId, opts);
  // The repo returns newest-first for the initial page (no `after`) and oldest-first
  // for polling deltas — normalize to ascending for display.
  const ordered = query.after ? rows : [...rows].reverse();
  const items = ordered.map((r) => toDTO(r, name));

  // readState is rebuilt on EVERY poll (fresh read cursors), independent of `after`.
  const readState = await buildReadState(
    session,
    conversationId,
    kind,
    counterpartId,
    roster,
    name,
  );

  return { items, readState };
}

// Mark a conversation read for the caller (R3). Best-effort at the edges: resolves
// the conversation and, if it exists, bumps last_read_at via the definer RPC.
export async function markRead(
  session: FullSession,
  withValue: string,
): Promise<void> {
  const { conversationId } = await resolveConversation(session, withValue);
  if (!conversationId) return; // nothing messaged yet → nothing to mark
  await conversationsRepo.markRead(conversationId);
}

export async function editMessage(
  session: FullSession,
  messageId: string,
  body: string,
): Promise<MessageDTO> {
  const orgId = session.organization.id;
  const row = await messagesRepo.updateBody(messageId, orgId, body);
  if (!row) {
    throw new ValidationError(
      "Message can no longer be edited (past the 10-minute window or not allowed)",
    );
  }
  const { name } = await loadRoster(orgId);
  return toDTO(row, name);
}

export async function deleteMessage(
  session: FullSession,
  messageId: string,
): Promise<MessageDTO> {
  const orgId = session.organization.id;
  const row = await messagesRepo.softDelete(messageId, orgId);
  if (!row) {
    throw new ValidationError(
      "Message can no longer be deleted (past the 10-minute window or not allowed)",
    );
  }
  const { name } = await loadRoster(orgId);
  return toDTO(row, name);
}

// The caller's unread counts, keyed the way the client addresses conversations
// (office / DM-by-counterpart / group-by-id). Only positive counts are included.
export async function getUnreadCounts(
  session: FullSession,
): Promise<UnreadCountsDTO> {
  const rows = await conversationsRepo.getUnreadCounts();
  const me = session.user.id.toLowerCase();
  const out: UnreadCountsDTO = { office: 0, dms: {}, groups: {}, total: 0 };

  for (const r of rows) {
    const n = Number(r.unread) || 0;
    if (n <= 0) continue;
    if (r.kind === "office") {
      out.office += n;
    } else if (r.kind === "group") {
      out.groups[r.conversation_id] = n;
    } else if (r.kind === "dm" && r.dm_key) {
      const [a, b] = r.dm_key.split(":");
      const counterpart = a === me ? b : a;
      if (counterpart) out.dms[counterpart] = n;
    }
    out.total += n;
  }
  return out;
}
