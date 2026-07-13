import "server-only";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as messagesService from "@/server/services/messages.service";

// GET /api/messages/unread
//   The caller's unread counts, keyed office / dms[userId] / groups[convId] + total
//   (Stage 14 / R3 badge). 200 UnreadCountsDTO · 401.
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  return ok(await messagesService.getUnreadCounts(session));
});
