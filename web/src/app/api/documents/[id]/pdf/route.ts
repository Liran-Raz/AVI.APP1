import "server-only";
import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { withErrorHandler } from "@/server/errors/api-handler";
import * as documentsService from "@/server/services/documents.service";
import { documentIdParamSchema } from "@/server/validators/documents.schema";

type RouteContext = { params: Promise<{ id: string }> };

// react-pdf rendering is CPU-bound; give it headroom over the default.
export const maxDuration = 30;

// GET /api/documents/[id]/pdf?copy=original|copy
// Streams the tax-document PDF. The FIRST "original" (מקור) also marks the
// document delivered (legal print-once); everything else is a "copy" (העתק).
// Returns the raw application/pdf bytes (NOT the JSON envelope).
export const GET = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = documentIdParamSchema.parse(await context.params);
    const requested =
      request.nextUrl.searchParams.get("copy") === "original"
        ? "original"
        : "copy";

    const { buffer, filename, copy } = await documentsService.renderDocumentPdf(
      session,
      id,
      requested,
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Document-Copy": copy,
      },
    });
  },
);
