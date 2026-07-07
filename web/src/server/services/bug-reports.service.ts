import "server-only";

import type { FullSession } from "@/server/auth/session";
import { toSafeErrorMeta } from "@/server/email/email-errors";
import * as bugReportsRepo from "@/server/repositories/bug-reports.repository";
import { sendBugReportNotificationEmail } from "@/server/services/emails.service";
import type { CreateBugReportPayload } from "@/server/validators/bug-reports.schema";

// Bug-report submission ("מצאת תקלה?", DEV-002). Any signed-in, onboarded
// member of an org may submit — no role/capability gate (matches the
// approved scope: visible to all authenticated users on every dashboard
// screen). org_id and reporter_user_id are ALWAYS injected from the
// session, never trusted from the client — same multi-tenancy discipline as
// every other service in this codebase.

export type SubmitBugReportResult = { submitted: true };

export async function submitBugReport(
  session: FullSession,
  input: CreateBugReportPayload,
): Promise<SubmitBugReportResult> {
  await bugReportsRepo.createBugReport({
    org_id: session.activeOrg.id,
    reporter_user_id: session.user.id,
    description: input.description,
    attempted_action: input.attemptedAction,
    page_url: input.pageUrl,
    user_agent: input.userAgent ?? null,
    client_logs: input.clientLogs,
  });

  // Best-effort notification. The report is already durably stored, so an
  // email failure must NOT fail the request — same pattern as
  // team.service.inviteMember's invitation email.
  await notifyBestEffort(session, input);

  return { submitted: true };
}

async function notifyBestEffort(
  session: FullSession,
  input: CreateBugReportPayload,
): Promise<void> {
  // Read directly from process.env (not the strict `env` module) — this is
  // an optional operational setting, same reasoning as RESEND_API_KEY/
  // MAIL_FROM in server/email/email.ts: absence must never fail the request
  // or server boot.
  const notifyEmail = process.env.BUG_REPORT_NOTIFY_EMAIL?.trim();
  if (!notifyEmail) {
    console.info(
      "[bug-reports.service] BUG_REPORT_NOTIFY_EMAIL not set — skipping notification email",
    );
    return;
  }

  try {
    await sendBugReportNotificationEmail({
      toEmail: notifyEmail,
      orgName: session.organization.name,
      reporterName: session.profile.full_name,
      reporterEmail: session.profile.email,
      description: input.description,
      attemptedAction: input.attemptedAction,
      pageUrl: input.pageUrl,
      consoleErrorCount: input.clientLogs.consoleErrors.length,
      failedRequestCount: input.clientLogs.failedRequests.length,
      actionTrailCount: input.clientLogs.actionTrail.length,
    });
  } catch (err) {
    // Log ONLY stable, allowlisted metadata via toSafeErrorMeta — never
    // err.message/stack or any provider body.
    console.error(
      "[bug-reports.service] notification email send failed",
      toSafeErrorMeta(err),
    );
  }
}
