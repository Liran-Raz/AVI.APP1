import { describe, it, expect } from "vitest";

import { createBugReportSchema } from "./bug-reports.schema";

const base = {
  description: "הכפתור לא הגיב",
  attemptedAction: null,
  pageUrl: "/tasks",
  userAgent: "Mozilla/5.0",
  clientLogs: { consoleErrors: [], failedRequests: [], actionTrail: [] },
};

describe("createBugReportSchema", () => {
  it("accepts a minimal valid report", () => {
    expect(createBugReportSchema.safeParse(base).success).toBe(true);
  });

  it("defaults clientLogs when omitted entirely", () => {
    const { clientLogs, ...withoutLogs } = base;
    void clientLogs;
    const r = createBugReportSchema.safeParse(withoutLogs);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.clientLogs).toEqual({
        consoleErrors: [],
        failedRequests: [],
        actionTrail: [],
      });
    }
  });

  it("rejects an empty description", () => {
    expect(
      createBugReportSchema.safeParse({ ...base, description: "   " })
        .success,
    ).toBe(false);
  });

  it("rejects a description longer than 2000 chars", () => {
    expect(
      createBugReportSchema.safeParse({
        ...base,
        description: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("coerces an empty/whitespace attemptedAction to null", () => {
    const r = createBugReportSchema.safeParse({
      ...base,
      attemptedAction: "   ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.attemptedAction).toBeNull();
  });

  it("rejects a missing pageUrl", () => {
    expect(
      createBugReportSchema.safeParse({ ...base, pageUrl: "" }).success,
    ).toBe(false);
  });

  it("rejects more than 20 console errors", () => {
    const consoleErrors = Array.from({ length: 21 }, (_, i) => ({
      message: `err ${i}`,
      timestamp: "2026-07-07T00:00:00.000Z",
    }));
    expect(
      createBugReportSchema.safeParse({
        ...base,
        clientLogs: { ...base.clientLogs, consoleErrors },
      }).success,
    ).toBe(false);
  });

  it("rejects more than 20 failed requests", () => {
    const failedRequests = Array.from({ length: 21 }, (_, i) => ({
      url: `/api/x${i}`,
      method: "GET",
      timestamp: "2026-07-07T00:00:00.000Z",
    }));
    expect(
      createBugReportSchema.safeParse({
        ...base,
        clientLogs: { ...base.clientLogs, failedRequests },
      }).success,
    ).toBe(false);
  });

  it("rejects more than 30 action-trail entries", () => {
    const actionTrail = Array.from({ length: 31 }, (_, i) => ({
      label: `click ${i}`,
      timestamp: "2026-07-07T00:00:00.000Z",
    }));
    expect(
      createBugReportSchema.safeParse({
        ...base,
        clientLogs: { ...base.clientLogs, actionTrail },
      }).success,
    ).toBe(false);
  });

  it("accepts a failed request without a status (network-level failure)", () => {
    const r = createBugReportSchema.safeParse({
      ...base,
      clientLogs: {
        ...base.clientLogs,
        failedRequests: [
          { url: "/api/x", method: "POST", timestamp: "2026-07-07T00:00:00.000Z" },
        ],
      },
    });
    expect(r.success).toBe(true);
  });
});
