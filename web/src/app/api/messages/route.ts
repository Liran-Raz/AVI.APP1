import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as messagesService from "@/server/services/messages.service";
import {
  listMessagesQuerySchema,
  sendMessageSchema,
} from "@/server/validators/messages.schema";

// GET /api/messages?with=group|<memberId>&after=<iso>&limit=<n>
//   Lists a conversation (office group or a 1:1 DM). `after` drives polling.
//   200 { items: MessageDTO[] } · 401 not signed in
export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const { searchParams } = new URL(request.url);
  const query = listMessagesQuerySchema.parse({
    with: searchParams.get("with") ?? undefined,
    after: searchParams.get("after") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  return ok(await messagesService.listMessages(session, query));
});

// POST /api/messages   Body: { body: string, recipientId?: string | null }
//   Sends a group message (no recipientId) or a DM. org_id + sender_id come from
//   the session. 200 MessageDTO · 400 invalid / non-member recipient · 401.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const raw = await request.json().catch(() => ({}));
  const input = sendMessageSchema.parse(raw);
  return ok(await messagesService.sendMessage(session, input));
});
