import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as conversationsService from "@/server/services/conversations.service";
import {
  addGroupMemberSchema,
  conversationIdParamSchema,
} from "@/server/validators/conversations.schema";

type RouteContext = { params: Promise<{ conversationId: string }> };

// POST /api/conversations/[conversationId]/members   Body: { userId: string }
//   Add a member (admin only — enforced in the DB). The target must be an active
//   member of the org. 200 GroupDetailDTO · 400 · 403 not admin · 404 · 401.
export const POST = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { conversationId } = conversationIdParamSchema.parse(
      await context.params,
    );
    const body = await request.json().catch(() => ({}));
    const { userId } = addGroupMemberSchema.parse(body);
    return ok(
      await conversationsService.addMember(session, conversationId, userId),
    );
  },
);
