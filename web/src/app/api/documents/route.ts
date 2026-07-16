import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as documentsService from "@/server/services/documents.service";
import {
  createDocumentSchema,
  listDocumentsQuerySchema,
} from "@/server/validators/documents.schema";

// GET /api/documents?docType=&status=&search=&limit=&offset=
// Returns: { success: true, data: { items: DocumentSummaryDTO[] } }
export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const query = listDocumentsQuerySchema.parse(params);
  const result = await documentsService.listDocuments(session, query);
  return ok(result);
});

// POST /api/documents — create a DRAFT (no number; issue is a separate action)
// Body: CreateDocumentPayload. Returns 201 with the full DocumentDTO.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = createDocumentSchema.parse(body);
  const created = await documentsService.createDraft(session, input);
  return ok(created, { status: 201 });
});
