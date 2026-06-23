import "server-only";

import type { FullSession } from "@/server/auth/session";
import * as notificationsRepo from "@/server/repositories/notifications.repository";
import type { Notification } from "@/server/db/domain.types";
import type { NotificationType } from "@/server/db/domain.types";
import type { ListNotificationsQuery } from "@/server/validators/notifications.schema";

// ============================================================
// DTO
// ============================================================

export type NotificationDTO = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
};

function toDTO(row: Notification): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    taskId: row.task_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

// ============================================================
// Public API
// ============================================================

export async function listNotifications(
  session: FullSession,
  query: ListNotificationsQuery,
): Promise<{ items: NotificationDTO[]; unreadCount: number }> {
  const userId = session.profile.id;
  const [rows, unreadCount] = await Promise.all([
    notificationsRepo.findManyByUserId(userId, {
      unreadOnly: query.unreadOnly,
      limit: query.limit,
    }),
    notificationsRepo.countUnreadByUserId(userId),
  ]);
  return { items: rows.map(toDTO), unreadCount };
}

export async function getUnreadCount(
  session: FullSession,
): Promise<{ count: number }> {
  const count = await notificationsRepo.countUnreadByUserId(session.profile.id);
  return { count };
}

export async function markRead(
  session: FullSession,
  id: string,
): Promise<{ id: string; alreadyRead: boolean }> {
  const row = await notificationsRepo.markRead(id, session.profile.id);
  // null can mean: notification doesn't exist, or it's already read.
  // We don't distinguish — both are non-errors from the client's POV
  // (the UI just needs to know it can no longer show it as unread).
  return { id, alreadyRead: row === null };
}

export async function markAllRead(
  session: FullSession,
): Promise<{ updatedCount: number }> {
  const updatedCount = await notificationsRepo.markAllRead(session.profile.id);
  return { updatedCount };
}
