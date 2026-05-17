import "server-only";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as notificationsService from "@/server/services/notifications.service";

// GET /api/notifications/unread-count
// Lightweight endpoint for the bell-badge polling loop. Returns:
//   { count: number }
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  const result = await notificationsService.getUnreadCount(session);
  return ok(result);
});
