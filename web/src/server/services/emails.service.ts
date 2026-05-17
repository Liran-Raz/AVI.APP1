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
  dueAt: string;
  creatorName: string;
  /** Absolute URL of the task (or queue) to view in the app */
  taskUrl: string;
};

export async function sendTaskAssignmentEmail(
  input: SendTaskAssignmentInput,
): Promise<void> {
  const subject = `משימה חדשה הוצמדה לך: ${input.taskTitle}`;
  const due = formatDueAt(input.dueAt);

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
