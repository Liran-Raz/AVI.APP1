import "server-only";

import { getEmailAdapter } from "@/server/email/email";

// Email service — composes message bodies and hands them to the
// active adapter. One function per email type keeps the templating
// in one place and makes it easy to A/B / localise later.

// Format a Date or ISO string as a Hebrew-friendly date+time.
function formatDueAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type SendTaskAssignmentInput = {
  toEmail: string;
  assigneeName: string;
  taskTitle: string;
  taskDescription: string | null;
  dueAt: string | null;
  creatorName: string;
  /** Absolute URL of the task (or queue) to view in the app */
  taskUrl: string;
};

export async function sendTaskAssignmentEmail(
  input: SendTaskAssignmentInput,
): Promise<void> {
  const subject = `משימה חדשה הוצמדה לך: ${input.taskTitle}`;
  const due = input.dueAt ? formatDueAt(input.dueAt) : "ללא תאריך יעד";

  const text = [
    `שלום ${input.assigneeName},`,
    "",
    `${input.creatorName} הקצה לך משימה חדשה במשרד:`,
    "",
    `נושא: ${input.taskTitle}`,
    `מועד יעד: ${due}`,
    input.taskDescription ? "" : null,
    input.taskDescription ? `תיאור: ${input.taskDescription}` : null,
    "",
    `לצפייה ולעדכון: ${input.taskUrl}`,
    "",
    "AVI.APP",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = `
<!doctype html>
<html lang="he" dir="rtl">
  <body style="font-family: Arial, Helvetica, sans-serif; background: #f7f9fb; padding: 24px; margin: 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(10,25,47,0.05);">
            <tr><td>
              <p style="margin: 0 0 16px 0; color: #44474d; font-size: 14px;">שלום ${escapeHtml(input.assigneeName)},</p>
              <h1 style="margin: 0 0 12px 0; color: #191c1e; font-size: 22px;">משימה חדשה הוצמדה לך</h1>
              <p style="margin: 0 0 24px 0; color: #44474d; font-size: 14px;">${escapeHtml(input.creatorName)} הקצה לך משימה חדשה במשרד.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border: 1px solid #c5c6cd; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
                <tr><td style="padding: 4px 0;">
                  <p style="margin: 0; color: #44474d; font-size: 12px;">נושא</p>
                  <p style="margin: 0; color: #191c1e; font-size: 16px; font-weight: 600;">${escapeHtml(input.taskTitle)}</p>
                </td></tr>
                <tr><td style="padding: 12px 0 4px 0;">
                  <p style="margin: 0; color: #44474d; font-size: 12px;">מועד יעד</p>
                  <p style="margin: 0; color: #191c1e; font-size: 14px;">${escapeHtml(due)}</p>
                </td></tr>
                ${
                  input.taskDescription
                    ? `<tr><td style="padding: 12px 0 4px 0;">
                  <p style="margin: 0; color: #44474d; font-size: 12px;">תיאור</p>
                  <p style="margin: 0; color: #191c1e; font-size: 14px; white-space: pre-wrap;">${escapeHtml(input.taskDescription)}</p>
                </td></tr>`
                    : ""
                }
              </table>
              <a href="${input.taskUrl}" style="display: inline-block; background: #0054cc; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 9999px; font-weight: 600; font-size: 14px;">צפייה ועדכון במערכת</a>
              <p style="margin: 32px 0 0 0; color: #75777e; font-size: 12px;">AVI.APP</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  await getEmailAdapter().send({
    to: input.toEmail,
    subject,
    text,
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================
// Team invitation email
// ============================================================

export type SendInvitationInput = {
  toEmail: string;
  inviterName: string;
  orgName: string;
  role: "admin" | "employee";
  inviteUrl: string;
  expiresAt: string;
};

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ROLE_LABEL_HE: Record<"admin" | "employee", string> = {
  admin: "מנהל",
  employee: "עובד",
};

export async function sendInvitationEmail(
  input: SendInvitationInput,
): Promise<void> {
  const subject = `הזמנה להצטרף ל-${input.orgName} ב-AVI.APP`;
  const roleHe = ROLE_LABEL_HE[input.role];
  const expiry = formatExpiry(input.expiresAt);

  const text = [
    `שלום,`,
    "",
    `${input.inviterName} מזמין/מזמינה אותך להצטרף למשרד "${input.orgName}" ב-AVI.APP כ${roleHe}.`,
    "",
    `הקישור לאישור ההזמנה (תקף עד ${expiry}):`,
    input.inviteUrl,
    "",
    "אם לא ביקשת את ההזמנה הזו, אפשר להתעלם מהמייל הזה.",
    "",
    "AVI.APP",
  ].join("\n");

  const html = `
<!doctype html>
<html lang="he" dir="rtl">
  <body style="font-family: Arial, Helvetica, sans-serif; background: #f7f9fb; padding: 24px; margin: 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(10,25,47,0.05);">
            <tr><td>
              <h1 style="margin: 0 0 12px 0; color: #191c1e; font-size: 22px;">הוזמנת להצטרף למשרד</h1>
              <p style="margin: 0 0 24px 0; color: #44474d; font-size: 14px;">
                ${escapeHtml(input.inviterName)} מזמין/מזמינה אותך להצטרף למשרד
                <strong>${escapeHtml(input.orgName)}</strong> ב-AVI.APP כ<strong>${escapeHtml(roleHe)}</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border: 1px solid #c5c6cd; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
                <tr><td style="padding: 4px 0;">
                  <p style="margin: 0; color: #44474d; font-size: 12px;">תוקף ההזמנה</p>
                  <p style="margin: 0; color: #191c1e; font-size: 14px;">עד ${escapeHtml(expiry)}</p>
                </td></tr>
              </table>
              <a href="${input.inviteUrl}" style="display: inline-block; background: #0054cc; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 9999px; font-weight: 600; font-size: 14px;">אשר/י את ההזמנה</a>
              <p style="margin: 24px 0 0 0; color: #75777e; font-size: 12px;">
                אם הקישור לא עובד, העתק/י אותו לדפדפן ידנית:<br/>
                <span dir="ltr" style="word-break: break-all;">${escapeHtml(input.inviteUrl)}</span>
              </p>
              <p style="margin: 24px 0 0 0; color: #75777e; font-size: 12px;">
                אם לא ביקשת את ההזמנה הזו, אפשר להתעלם מהמייל הזה.
              </p>
              <p style="margin: 32px 0 0 0; color: #75777e; font-size: 12px;">AVI.APP</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  await getEmailAdapter().send({
    to: input.toEmail,
    subject,
    text,
    html,
  });
}

// ============================================================
// Bug report notification email (DEV-002)
// ============================================================

export type SendBugReportNotificationInput = {
  toEmail: string;
  orgName: string;
  reporterName: string;
  reporterEmail: string;
  description: string;
  attemptedAction: string | null;
  pageUrl: string;
  consoleErrorCount: number;
  failedRequestCount: number;
  actionTrailCount: number;
};

// Lean summary email — counts only, not the full client_logs payload. The
// complete report (including the raw logs) lives in the bug_reports row;
// this email is just the "something came in, go look" ping.
export async function sendBugReportNotificationEmail(
  input: SendBugReportNotificationInput,
): Promise<void> {
  const subject = `דיווח תקלה חדש מ-${input.orgName}`;

  const text = [
    `דיווח תקלה חדש התקבל במערכת:`,
    "",
    `משרד: ${input.orgName}`,
    `דווח ע"י: ${input.reporterName} (${input.reporterEmail})`,
    `עמוד: ${input.pageUrl}`,
    "",
    `תיאור:`,
    input.description,
    input.attemptedAction ? "" : null,
    input.attemptedAction ? `מה ניסה לעשות: ${input.attemptedAction}` : null,
    "",
    `לוגים מצורפים: ${input.consoleErrorCount} שגיאות קונסולה, ${input.failedRequestCount} בקשות שנכשלו, ${input.actionTrailCount} פעולות אחרונות.`,
    "הפירוט המלא נמצא בטבלת bug_reports ב-Supabase.",
    "",
    "AVI.APP",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = `
<!doctype html>
<html lang="he" dir="rtl">
  <body style="font-family: Arial, Helvetica, sans-serif; background: #f7f9fb; padding: 24px; margin: 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(10,25,47,0.05);">
            <tr><td>
              <h1 style="margin: 0 0 12px 0; color: #191c1e; font-size: 22px;">דיווח תקלה חדש</h1>
              <p style="margin: 0 0 24px 0; color: #44474d; font-size: 14px;">
                מ-<strong>${escapeHtml(input.orgName)}</strong>, ע"י ${escapeHtml(input.reporterName)}
                (<span dir="ltr">${escapeHtml(input.reporterEmail)}</span>)
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border: 1px solid #c5c6cd; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
                <tr><td style="padding: 4px 0;">
                  <p style="margin: 0; color: #44474d; font-size: 12px;">עמוד</p>
                  <p style="margin: 0; color: #191c1e; font-size: 14px;" dir="ltr">${escapeHtml(input.pageUrl)}</p>
                </td></tr>
                <tr><td style="padding: 12px 0 4px 0;">
                  <p style="margin: 0; color: #44474d; font-size: 12px;">תיאור</p>
                  <p style="margin: 0; color: #191c1e; font-size: 14px; white-space: pre-wrap;">${escapeHtml(input.description)}</p>
                </td></tr>
                ${
                  input.attemptedAction
                    ? `<tr><td style="padding: 12px 0 4px 0;">
                  <p style="margin: 0; color: #44474d; font-size: 12px;">מה ניסה לעשות</p>
                  <p style="margin: 0; color: #191c1e; font-size: 14px; white-space: pre-wrap;">${escapeHtml(input.attemptedAction)}</p>
                </td></tr>`
                    : ""
                }
              </table>
              <p style="margin: 0; color: #75777e; font-size: 12px;">
                ${input.consoleErrorCount} שגיאות קונסולה · ${input.failedRequestCount} בקשות שנכשלו · ${input.actionTrailCount} פעולות אחרונות.
                הפירוט המלא בטבלת <span dir="ltr">bug_reports</span> ב-Supabase.
              </p>
              <p style="margin: 32px 0 0 0; color: #75777e; font-size: 12px;">AVI.APP</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  await getEmailAdapter().send({
    to: input.toEmail,
    subject,
    text,
    html,
  });
}
