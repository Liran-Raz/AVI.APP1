import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { CreateBugReportPayload } from "@/server/validators/bug-reports.schema";

vi.mock("@/server/repositories/bug-reports.repository", () => ({
  createBugReport: vi.fn(),
}));
vi.mock("@/server/services/emails.service", () => ({
  sendBugReportNotificationEmail: vi.fn(),
}));

import * as bugReportsRepo from "@/server/repositories/bug-reports.repository";
import { sendBugReportNotificationEmail } from "@/server/services/emails.service";
import { submitBugReport } from "./bug-reports.service";

const repo = vi.mocked(bugReportsRepo);
const sendEmail = vi.mocked(sendBugReportNotificationEmail);

function session(): FullSession {
  return {
    user: { id: "user-1", email: "user@x.test" },
    profile: { id: "user-1", full_name: "Dana Cohen", email: "user@x.test" },
    organization: { id: "org-1", name: "Test Org" },
    activeOrg: { id: "org-1", name: "Test Org" },
    activeRole: "employee",
    memberships: [],
  } as unknown as FullSession;
}

const payload: CreateBugReportPayload = {
  description: "הכפתור לא הגיב",
  attemptedAction: "ניסיתי לשמור משימה",
  pageUrl: "/tasks",
  userAgent: "Mozilla/5.0",
  clientLogs: {
    consoleErrors: [{ message: "TypeError: x", timestamp: "t" }],
    failedRequests: [{ url: "/api/tasks", method: "POST", status: 500, timestamp: "t" }],
    actionTrail: [{ label: "לחיצה על שמירה", timestamp: "t" }],
  },
};

const savedEnv = process.env.BUG_REPORT_NOTIFY_EMAIL;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.BUG_REPORT_NOTIFY_EMAIL;
  else process.env.BUG_REPORT_NOTIFY_EMAIL = savedEnv;
});

describe("submitBugReport", () => {
  it("injects org_id and reporter_user_id from the session, never trusts the payload", async () => {
    process.env.BUG_REPORT_NOTIFY_EMAIL = "team@x.test";
    await submitBugReport(session(), payload);
    expect(repo.createBugReport).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org-1",
        reporter_user_id: "user-1",
        description: payload.description,
        attempted_action: payload.attemptedAction,
        page_url: payload.pageUrl,
        user_agent: payload.userAgent,
        client_logs: payload.clientLogs,
      }),
    );
  });

  it("returns { submitted: true } on success", async () => {
    delete process.env.BUG_REPORT_NOTIFY_EMAIL;
    const result = await submitBugReport(session(), payload);
    expect(result).toEqual({ submitted: true });
  });

  it("sends a notification email with counts, not the raw logs, when BUG_REPORT_NOTIFY_EMAIL is set", async () => {
    process.env.BUG_REPORT_NOTIFY_EMAIL = "team@x.test";
    await submitBugReport(session(), payload);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "team@x.test",
        orgName: "Test Org",
        reporterName: "Dana Cohen",
        reporterEmail: "user@x.test",
        consoleErrorCount: 1,
        failedRequestCount: 1,
        actionTrailCount: 1,
      }),
    );
  });

  it("skips the notification email entirely when BUG_REPORT_NOTIFY_EMAIL is not set", async () => {
    delete process.env.BUG_REPORT_NOTIFY_EMAIL;
    await submitBugReport(session(), payload);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not throw and still returns success when the notification email fails", async () => {
    process.env.BUG_REPORT_NOTIFY_EMAIL = "team@x.test";
    sendEmail.mockRejectedValueOnce(new Error("smtp down"));
    const result = await submitBugReport(session(), payload);
    expect(result).toEqual({ submitted: true });
  });

  it("propagates a repository failure (report was not saved)", async () => {
    repo.createBugReport.mockRejectedValueOnce(new Error("db error"));
    await expect(submitBugReport(session(), payload)).rejects.toThrow(
      "db error",
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
