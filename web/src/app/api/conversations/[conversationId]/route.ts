import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as conversationsService from "@/server/services/conversations.service";
import {
  conversationIdParamSchema,
  renameGroupSchema,
} from "@/server/validators/conversations.schema";

type RouteContext = { params: Promise<{ conversationId: string }> };

// GET /api/conversations/[conversationId]
//   Group detail (title, isAdmin, active members). 200 GroupDetailDTO · 404 if the
//   group doesn't exist / is deleted / the caller isn't a member · 401.
export const GET = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { conversationId } = conversationIdParamSchema.parse(
      await context.params,
    );
    return ok(await conversationsService.getGroupDetail(session, conversationId));
  },
);

// PATCH /api/conversations/[conversationId]   Body: { title: string }
//   Rename the group (admin only — enforced in the DB). 200 GroupDetailDTO ·
//   400 invalid title · 403 not admin · 404 · 401.
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { conversationId } = conversationIdParamSchema.parse(
      await context.params,
    );
    const body = await request.json().catch(() => ({}));
    const { title } = renameGroupSchema.parse(body);
    return ok(
      await conversationsService.renameGroup(session, conversationId, title),
    );
  },
);

// DELETE /api/conversations/[conversationId]
//   Soft-delete the group for everyone (admin only). 200 { deleted: true } ·
//   403 not admin · 404 · 401.
export const DELETE = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { conversationId } = conversationIdParamSchema.parse(
      await context.params,
    );
    await conversationsService.deleteGroup(session, conversationId);
    return ok({ deleted: true });
  },
);
