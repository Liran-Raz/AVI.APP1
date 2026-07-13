import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as messagesService from "@/server/services/messages.service";
import {
  editMessageSchema,
  messageIdParamSchema,
} from "@/server/validators/messages.schema";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/messages/[id]   Body: { body: string }
//   Edit a message body (sender + ≤10 min, enforced in the DB). Returns the updated
//   message (editedAt set). 200 MessageDTO · 400 window passed / not allowed · 401.
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = messageIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const input = editMessageSchema.parse(body);
    return ok(await messagesService.editMessage(session, id, input.body));
  },
);

// DELETE /api/messages/[id]
//   Soft-delete (tombstone) a message (sender + ≤10 min). Returns the tombstoned
//   message (deletedAt set, body blanked). 200 MessageDTO · 400 · 401.
export const DELETE = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = messageIdParamSchema.parse(await context.params);
    return ok(await messagesService.deleteMessage(session, id));
  },
);
