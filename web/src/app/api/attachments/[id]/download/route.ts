import "server-only";
import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { withErrorHandler } from "@/server/errors/api-handler";
import * as attachmentsService from "@/server/services/attachments.service";
import { attachmentIdParamSchema } from "@/server/validators/attachments.schema";

// Decryption runs in-process (node:crypto) — force the Node runtime + headroom.
export const runtime = "nodejs";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/attachments/[id]/download — streams the DECRYPTED bytes (not the
// JSON envelope). Always `attachment` disposition + nosniff so a stored file can
// never render inline (defense in depth on top of the upload MIME allowlist).
export const GET = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = attachmentIdParamSchema.parse(await context.params);
    const { bytes, fileName, mimeType } =
      await attachmentsService.getAttachmentDownload(session, id);

    // RFC 5987: an ASCII fallback + a UTF-8 name (Hebrew filenames are common).
    const asciiName = fileName.replace(/[^ -~]/g, "_");
    const encodedName = encodeURIComponent(fileName);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
