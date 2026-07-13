import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as messagesService from "@/server/services/messages.service";
import { markReadSchema } from "@/server/validators/messages.schema";

// POST /api/messages/read   Body: { with: "group" | <memberId> | "conv:<id>" }
//   Marks the conversation read for the caller (bumps last_read_at via a definer
//   RPC). No-op if the conversation has no messages yet. 200 { ok: true } · 401.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const raw = await request.json().catch(() => ({}));
  const { with: withValue } = markReadSchema.parse(raw);
  await messagesService.markRead(session, withValue);
  return ok({ ok: true });
});
