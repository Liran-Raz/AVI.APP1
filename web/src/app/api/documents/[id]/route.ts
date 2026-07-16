import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as documentsService from "@/server/services/documents.service";
import {
  documentIdParamSchema,
  updateDocumentSchema,
} from "@/server/validators/documents.schema";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/documents/[id] — full document (header + lines + payments)
export const GET = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = documentIdParamSchema.parse(await context.params);
    const doc = await documentsService.getDocument(session, id);
    return ok(doc);
  },
);

// PATCH /api/documents/[id] — edit a DRAFT (lines/payments = replace-all)
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = documentIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const input = updateDocumentSchema.parse(body);
    const updated = await documentsService.updateDraft(session, id, input);
    return ok(updated);
  },
);

// DELETE /api/documents/[id] — delete a DRAFT (issued docs are immutable)
export const DELETE = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = documentIdParamSchema.parse(await context.params);
    await documentsService.deleteDraft(session, id);
    return ok(null);
  },
);
