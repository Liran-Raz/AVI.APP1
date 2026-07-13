import "server-only";

import type { FullSession } from "@/server/auth/session";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";
import * as conversationsRepo from "@/server/repositories/conversations.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import type { CreateGroupPayload } from "@/server/validators/conversations.schema";

// Group-conversation service (Stage 14 / R2). Group lifecycle (create / rename /
// add / remove / leave / delete) + read models for the conversation list and the
// manage panel. Authorization is enforced in the DB (SECURITY DEFINER RPCs, 0025):
// only a group ADMIN may manage; any participant may leave. The service maps the
// RPCs' SQLSTATEs to AppErrors and shapes DTOs (org_id + internals are stripped).

export type GroupMemberDTO = {
  id: string;
  name: string;
  isAdmin: boolean;
};

export type GroupSummaryDTO = {
  id: string;
  title: string;
  isAdmin: boolean; // is the CALLER an admin of this group
  memberCount: number; // active participants
  lastMessageAt: string | null;
};

export type GroupDetailDTO = {
  id: string;
  title: string;
  isAdmin: boolean;
  members: GroupMemberDTO[];
};

// Resolve display names from the org roster (small; one read). Falls back to a
// neutral label for a since-removed member.
async function nameResolver(orgId: string): Promise<(id: string) => string> {
  const roster = await teamRepo.findMembersByOrgId(orgId);
  const byId = new Map(roster.map((m) => [m.userId, m.fullName || "—"]));
  return (id: string) => byId.get(id) ?? "משתמש";
}

// Translate a raised RPC SQLSTATE into a clean AppError. 42501 = not authorized
// (also missing/deleted group — reported uniformly so a caller can't probe for
// existence); 22023 = invalid argument (the RPC messages are user-safe English).
function mapRpcError(err: unknown): never {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "42501") {
    throw new ForbiddenError("You are not allowed to manage this group");
  }
  if (e?.code === "22023") {
    throw new ValidationError(e.message || "Invalid group operation");
  }
  if (err instanceof AppError) throw err;
  throw new AppError("INTERNAL_ERROR", "Group operation failed", 500);
}

async function runRpc<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    mapRpcError(err);
  }
}

// The caller's group conversations, newest-activity first. Office + DMs are NOT
// here (the client derives those from the roster, as in R1) — only custom groups.
export async function listMyGroups(
  session: FullSession,
): Promise<{ items: GroupSummaryDTO[] }> {
  const orgId = session.organization.id;
  const parts = await conversationsRepo.listMyGroupParticipations(
    orgId,
    session.user.id,
  );
  const ids = parts.map((p) => p.conversationId);
  if (ids.length === 0) return { items: [] };

  const [groups, activeParts] = await Promise.all([
    conversationsRepo.findGroupsByIds(orgId, ids),
    conversationsRepo.listActiveParticipants(ids),
  ]);

  const adminByConv = new Map(parts.map((p) => [p.conversationId, p.isAdmin]));
  const countByConv = new Map<string, number>();
  for (const p of activeParts) {
    countByConv.set(
      p.conversation_id,
      (countByConv.get(p.conversation_id) ?? 0) + 1,
    );
  }

  const items = groups
    .map((g) => ({
      id: g.id,
      title: g.title ?? "קבוצה",
      isAdmin: adminByConv.get(g.id) === true,
      memberCount: countByConv.get(g.id) ?? 0,
      lastMessageAt: g.last_message_at,
    }))
    .sort((a, b) => {
      // Newest activity first; groups with no messages sort last.
      const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return bt - at;
    });

  return { items };
}

// The manage panel: title, whether the caller is admin, and the active member
// list. 404 if the group doesn't exist, is deleted, or the caller isn't in it.
export async function getGroupDetail(
  session: FullSession,
  convId: string,
): Promise<GroupDetailDTO> {
  const orgId = session.organization.id;
  const group = await conversationsRepo.getGroupById(orgId, convId);
  if (!group) throw new NotFoundError("Group not found");

  const [parts, name] = await Promise.all([
    conversationsRepo.listActiveParticipants([convId]),
    nameResolver(orgId),
  ]);

  const members: GroupMemberDTO[] = parts.map((p) => ({
    id: p.user_id,
    name: name(p.user_id),
    isAdmin: p.is_admin === true,
  }));
  const isAdmin = parts.some(
    (p) => p.user_id === session.user.id && p.is_admin,
  );

  return { id: group.id, title: group.title ?? "קבוצה", isAdmin, members };
}

export async function createGroup(
  session: FullSession,
  input: CreateGroupPayload,
): Promise<GroupSummaryDTO> {
  const orgId = session.organization.id;
  const convId = await runRpc(() =>
    conversationsRepo.createGroup(orgId, input.title, input.memberIds),
  );

  const [group, parts] = await Promise.all([
    conversationsRepo.getGroupById(orgId, convId),
    conversationsRepo.listActiveParticipants([convId]),
  ]);
  return {
    id: convId,
    title: group?.title ?? input.title,
    isAdmin: true, // the creator is always the admin
    memberCount: parts.length,
    lastMessageAt: group?.last_message_at ?? null,
  };
}

export async function renameGroup(
  session: FullSession,
  convId: string,
  title: string,
): Promise<GroupDetailDTO> {
  await runRpc(() => conversationsRepo.renameGroup(convId, title));
  return getGroupDetail(session, convId);
}

export async function addMember(
  session: FullSession,
  convId: string,
  userId: string,
): Promise<GroupDetailDTO> {
  await runRpc(() => conversationsRepo.addMember(convId, userId));
  return getGroupDetail(session, convId);
}

export async function removeMember(
  session: FullSession,
  convId: string,
  userId: string,
): Promise<GroupDetailDTO> {
  await runRpc(() => conversationsRepo.removeMember(convId, userId));
  return getGroupDetail(session, convId);
}

export async function leaveGroup(
  session: FullSession,
  convId: string,
): Promise<void> {
  await runRpc(() => conversationsRepo.leaveGroup(convId));
}

export async function deleteGroup(
  session: FullSession,
  convId: string,
): Promise<void> {
  await runRpc(() => conversationsRepo.deleteGroup(convId));
}
