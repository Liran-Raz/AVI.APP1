import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as documentsService from "@/server/services/documents.service";
import {
  cancelDocumentSchema,
  documentIdParamSchema,
} from "@/server/validators/documents.schema";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/documents/[id]/cancel — pre-delivery only (the RPC enforces it);
// the number is retained and the document is flagged cancelled (מבנה אחיד 1228).
export const POST = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = documentIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const { reason } = cancelDocumentSchema.parse(body);
    await documentsService.cancelDocument(session, id, reason);
    return ok(null);
  },
);
