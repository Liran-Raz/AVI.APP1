import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as documentsService from "@/server/services/documents.service";
import { documentIdParamSchema } from "@/server/validators/documents.schema";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/documents/[id]/issue — the legal transition: assigns the gap-free
// number, freezes snapshots + totals (all computed in the DB RPC).
// Returns: { success: true, data: { number, issuedAt } }
export const POST = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = documentIdParamSchema.parse(await context.params);
    const result = await documentsService.issueDocument(session, id);
    return ok(result);
  },
);
