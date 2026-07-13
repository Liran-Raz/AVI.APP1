import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as conversationsService from "@/server/services/conversations.service";
import { groupMemberParamsSchema } from "@/server/validators/conversations.schema";

type RouteContext = {
  params: Promise<{ conversationId: string; userId: string }>;
};

// DELETE /api/conversations/[conversationId]/members/[userId]
//   Remove a member (admin only — enforced in the DB). Cannot remove yourself
//   (use /leave). 200 GroupDetailDTO · 400 self · 403 not admin · 404 · 401.
export const DELETE = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { conversationId, userId } = groupMemberParamsSchema.parse(
      await context.params,
    );
    return ok(
      await conversationsService.removeMember(session, conversationId, userId),
    );
  },
);
