import "server-only";

import type { FullSession } from "@/server/auth/session";
import * as notificationsRepo from "@/server/repositories/notifications.repository";
import type { Notification } from "@/server/db/domain.types";
import type { NotificationType } from "@/server/db/domain.types";
import type { ListNotificationsQuery } from "@/server/validators/notifications.schema";
import { readNotificationPrefs } from "@/server/services/profile.service";

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

// Notification types the caller has soft-muted for the bell badge. Soft-mute
// (DEV-014) means the rows still exist and still appear in the list — they
// just don't count toward the unread badge. Keyed off the caller's own prefs.
function mutedBellTypes(session: FullSession): NotificationType[] {
  const prefs = readNotificationPrefs(session.profile.notification_prefs);
  return prefs.bellOnTaskAssignment ? [] : ["task_assigned"];
}

export async function listNotifications(
  session: FullSession,
  query: ListNotificationsQuery,
): Promise<{ items: NotificationDTO[]; unreadCount: number }> {
  const userId = session.profile.id;
  // The LIST is intentionally NOT filtered — a soft-muted assignment still
  // shows in the bell. Only the COUNT (the red badge) excludes muted types.
  const [rows, unreadCount] = await Promise.all([
    notificationsRepo.findManyByUserId(userId, {
      unreadOnly: query.unreadOnly,
      limit: query.limit,
    }),
    notificationsRepo.countUnreadByUserId(userId, {
      excludeTypes: mutedBellTypes(session),
    }),
  ]);
  return { items: rows.map(toDTO), unreadCount };
}

export async function getUnreadCount(
  session: FullSession,
): Promise<{ count: number }> {
  const count = await notificationsRepo.countUnreadByUserId(session.profile.id, {
    excludeTypes: mutedBellTypes(session),
  });
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
