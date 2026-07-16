import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as documentsService from "@/server/services/documents.service";
import { documentIdParamSchema } from "@/server/validators/documents.schema";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/documents/[id]/credit — creates a DRAFT credit note (330)
// mirroring the issued base document. Returns { id } of the new draft.
export const POST = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = documentIdParamSchema.parse(await context.params);
    const result = await documentsService.createCreditNote(session, id);
    return ok(result, { status: 201 });
  },
);
