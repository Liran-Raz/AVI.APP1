import "server-only";
import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as reportsService from "@/server/services/reports.service";
import {
  openFormatModeSchema,
  reportRangeQuerySchema,
} from "@/server/validators/reports.schema";

// Assembling + zipping a full year of books is CPU-bound; allow headroom.
export const maxDuration = 30;

// GET /api/reports/export/openformat?from=&to=&mode=summary|download
//   mode=summary  — JSON preview: record counts, path, warnings (the נספח-4
//                   report data, shown before/after the download).
//   mode=download — streams the ZIP (OPENFRMT tree: INI.TXT + BKMVDATA.zip).
// Both are gated on invoices.export (owner-only) in the service.
export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const range = reportRangeQuerySchema.parse(params);
  const mode = openFormatModeSchema.parse(params.mode);

  if (mode === "summary") {
    return ok(await reportsService.getOpenFormatSummary(session, range));
  }

  const { buffer, fileName } = await reportsService.exportOpenFormatZip(
    session,
    range,
  );
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
});
