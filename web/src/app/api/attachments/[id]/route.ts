import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as attachmentsService from "@/server/services/attachments.service";
import {
  archiveAttachmentSchema,
  attachmentIdParamSchema,
} from "@/server/validators/attachments.schema";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/attachments/[id] — archive toggle. Body: { archived: boolean }.
// The only client-writable field (the immutability trigger freezes the rest).
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = attachmentIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const { archived } = archiveAttachmentSchema.parse(body);
    const dto = await attachmentsService.setArchived(session, id, archived);
    return ok(dto);
  },
);
