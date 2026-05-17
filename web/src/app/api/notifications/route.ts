import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as notificationsService from "@/server/services/notifications.service";
import { listNotificationsQuerySchema } from "@/server/validators/notifications.schema";

// GET /api/notifications?unreadOnly=true&limit=20
// Returns: { items: NotificationDTO[], unreadCount: number }
export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const query = listNotificationsQuerySchema.parse(params);
  const result = await notificationsService.listNotifications(session, query);
  return ok(result);
});
