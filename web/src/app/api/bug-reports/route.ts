import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as bugReportsService from "@/server/services/bug-reports.service";
import { createBugReportSchema } from "@/server/validators/bug-reports.schema";

// POST /api/bug-reports
// Body: { description, attemptedAction?, pageUrl, userAgent?, clientLogs }
// Returns: { success: true, data: { submitted: true } }
//
// Any signed-in, onboarded member may submit ("מצאת תקלה?", DEV-002) — no
// role gate. org_id/reporter_user_id come from the session, never the body.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = createBugReportSchema.parse(body);
  const result = await bugReportsService.submitBugReport(session, input);
  return ok(result);
});
