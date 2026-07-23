import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import { ValidationError } from "@/server/errors/app-error";
import * as attachmentsService from "@/server/services/attachments.service";
import {
  listAttachmentsQuerySchema,
  uploadAttachmentMetaSchema,
} from "@/server/validators/attachments.schema";

// Encryption runs in-process (node:crypto) — force the Node runtime, and give
// the upload/encrypt path headroom over the default.
export const runtime = "nodejs";
export const maxDuration = 30;

// GET /api/attachments?scope=client&clientId=… | scope=task&taskId=… |
//                       scope=office&folder=files|additional|tasks|clients|archive
// Returns: { success: true, data: { items: AttachmentDTO[] } }
export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const query = listAttachmentsQuerySchema.parse(params);
  const result = await attachmentsService.listAttachments(session, query);
  return ok(result);
});

// POST /api/attachments — multipart upload. Fields: file (binary),
// context (client|office|task), contextId (uuid; for client/task), category.
// The service encrypts, stores ciphertext, and mints the row. Returns 201.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();

  const form = await request.formData().catch(() => null);
  if (!form) throw new ValidationError("Expected multipart/form-data");

  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("A file is required");

  const rawContextId = form.get("contextId");
  const meta = uploadAttachmentMetaSchema.parse({
    context: form.get("context"),
    contextId: typeof rawContextId === "string" ? rawContextId : undefined,
    category: form.get("category"),
  });

  const bytes = Buffer.from(await file.arrayBuffer());
  const created = await attachmentsService.uploadAttachment(session, meta, {
    bytes,
    fileName: file.name,
    mimeType: file.type,
  });
  return ok(created, { status: 201 });
});
