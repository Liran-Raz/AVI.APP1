import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as reportsService from "@/server/services/reports.service";
import {
  reportFormatSchema,
  reportRangeQuerySchema,
} from "@/server/validators/reports.schema";

type RouteContext = { params: Promise<{ report: string }> };

const reportNameSchema = z.enum([
  "summary",
  "sales",
  "receipts",
  "vat",
  "client-balances",
]);

// GET /api/reports/[report]?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]
//   summary          — count + monetary total per נספח-1 document type
//   sales            — ספר מכירות (305/320/330)
//   receipts         — ספר תקבולים (payment lines of 400/320)
//   vat              — סיכום מע"מ עסקאות by month
//   client-balances  — מאזן לקוחות (informational)
// JSON needs reports.view; format=csv needs reports.export (service-gated).
export const GET = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { report } = await context.params;
    const reportName = reportNameSchema.parse(report);
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const range = reportRangeQuerySchema.parse(params);
    const format = reportFormatSchema.parse(params.format);

    if (format === "csv") {
      const { content, fileName } = await reportsService.getReportCsv(
        session,
        reportName,
        range,
      );
      return new NextResponse(content, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    switch (reportName) {
      case "summary":
        return ok({ rows: await reportsService.getDocTypeSummary(session, range) });
      case "sales":
        return ok(await reportsService.getSalesBook(session, range));
      case "receipts":
        return ok(await reportsService.getReceiptsBook(session, range));
      case "vat":
        return ok(await reportsService.getVatSummary(session, range));
      case "client-balances":
        return ok({ rows: await reportsService.getClientBalances(session, range) });
    }
  },
);
