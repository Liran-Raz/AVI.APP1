import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as notificationsService from "@/server/services/notifications.service";
import { notificationIdParamSchema } from "@/server/validators/notifications.schema";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/notifications/[id]/read
// Marks a single notification as read. Idempotent — calling on an
// already-read notification returns { id, alreadyRead: true } without
// modifying read_at.
export const POST = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = notificationIdParamSchema.parse(await context.params);
    const result = await notificationsService.markRead(session, id);
    return ok(result);
  },
);
