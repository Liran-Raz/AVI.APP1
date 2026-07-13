import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as conversationsService from "@/server/services/conversations.service";
import { conversationIdParamSchema } from "@/server/validators/conversations.schema";

type RouteContext = { params: Promise<{ conversationId: string }> };

// POST /api/conversations/[conversationId]/leave
//   Leave the group (any active participant). If the last admin leaves, admin
//   succession runs in the DB; if the last member leaves, the group is retired.
//   200 { left: true } · 403 not a member · 404 · 401.
export const POST = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { conversationId } = conversationIdParamSchema.parse(
      await context.params,
    );
    await conversationsService.leaveGroup(session, conversationId);
    return ok({ left: true });
  },
);
