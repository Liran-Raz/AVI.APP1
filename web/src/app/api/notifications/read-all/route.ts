import "server-only";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as notificationsService from "@/server/services/notifications.service";

// POST /api/notifications/read-all
// Marks every unread notification for the current user as read.
// Returns: { updatedCount: number }
export const POST = withErrorHandler(async () => {
  const session = await requireSession();
  const result = await notificationsService.markAllRead(session);
  return ok(result);
});
