import "server-only";

import type { FullSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors/app-error";
import * as messagesRepo from "@/server/repositories/messages.repository";
import * as conversationsRepo from "@/server/repositories/conversations.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import type { Message } from "@/server/db/domain.types";
import type {
  ListMessagesQuery,
  SendMessagePayload,
} from "@/server/validators/messages.schema";

// Office chat service (Stage 13 R5). Sends (group or DM) + lists a conversation.
// Multi-tenancy: org_id + sender_id are injected from the session (never from the
// client). A DM recipient must be an active member of the SAME org (F1-style
// cross-org guard) — RLS already enforces the sender side.

export type MessageDTO = {
  id: string;
  body: string;
  senderId: string;
  senderName: string;
  recipientId: string | null;
  createdAt: string;
};

// Resolve sender display names from the org roster (small; one read). Falls back
// to a neutral label for a since-removed member.
async function nameResolver(orgId: string): Promise<(id: string) => string> {
  const roster = await teamRepo.findMembersByOrgId(orgId);
  const byId = new Map(roster.map((m) => [m.userId, m.fullName || "—"]));
  return (id: string) => byId.get(id) ?? "משתמש";
}

function toDTO(row: Message, name: (id: string) => string): MessageDTO {
  return {
    id: row.id,
    body: row.body,
    senderId: row.sender_id,
    senderName: name(row.sender_id),
    recipientId: row.recipient_id,
    createdAt: row.created_at,
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

export async function sendMessage(
  session: FullSession,
  input: SendMessagePayload,
): Promise<MessageDTO> {
  const orgId = session.organization.id;
  const recipientId = input.recipientId ?? null;

  // Resolve the target conversation. recipient_id is ALSO populated (office=null,
  // dm=recipient) so the legacy indexes + rollback stay consistent (Stage 14 R1).
  let conversationId: string;
  if (recipientId) {
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

  const name = await nameResolver(orgId);
  return toDTO(row, name);
}

export async function listMessages(
  session: FullSession,
  query: ListMessagesQuery,
): Promise<{ items: MessageDTO[] }> {
  const orgId = session.organization.id;
  const opts = { after: query.after, limit: query.limit };

  let conversationId: string | null;
  if (query.with === "group") {
    // Read-only: no office conversation yet (new org, no messages) → empty feed.
    conversationId = (await conversationsRepo.findOffice(orgId))?.id ?? null;
  } else {
    // DM thread: the counterpart must be (or have been) a member of THIS org.
    // Unlike SENDING, we do NOT require them to still be active — a deactivated
    // colleague's existing thread stays readable (RLS already limits rows to the
    // caller's own DMs). Sending to a deactivated member is still blocked.
    const membership = await membershipsRepo.findByUserAndOrg(query.with, orgId);
    if (!membership) {
      throw new ValidationError("Not a member of this organization");
    }
    // Read-only: merely OPENING a never-messaged DM must not create a row.
    conversationId =
      (await conversationsRepo.findDm(orgId, session.user.id, query.with))?.id ?? null;
  }

  if (!conversationId) return { items: [] };

  const rows = await messagesRepo.findByConversation(orgId, conversationId, opts);

  // The repo returns newest-first for the initial page (no `after`) and
  // oldest-first for polling deltas — normalize to ascending for display.
  const ordered = query.after ? rows : [...rows].reverse();
  const name = await nameResolver(orgId);
  return { items: ordered.map((r) => toDTO(r, name)) };
}
