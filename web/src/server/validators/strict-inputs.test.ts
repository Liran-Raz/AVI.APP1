import { describe, expect, it } from "vitest";

import {
  changePasswordSchema,
  forgotPasswordSchema,
  mfaConfirmSchema,
  mfaVerifySchema,
  resetPasswordSchema,
  signinSchema,
  signupSchema,
} from "./auth.schema";
import { setActiveOrgSchema } from "./active-org.schema";
import { createBugReportSchema } from "./bug-reports.schema";
import {
  createContactSchema,
  updateContactSchema,
} from "./client-contacts.schema";
import { createClientSchema, updateClientSchema } from "./clients.schema";
import {
  addGroupMemberSchema,
  createGroupSchema,
  renameGroupSchema,
} from "./conversations.schema";
import {
  cancelDocumentSchema,
  createDocumentSchema,
  updateDocumentSchema,
} from "./documents.schema";
import { updateLedgerSchema } from "./ledgers.schema";
import { setLocaleSchema } from "./locale.schema";
import {
  editMessageSchema,
  listMessagesQuerySchema,
  markReadSchema,
  sendMessageSchema,
} from "./messages.schema";
import { bootstrapOrgSchema } from "./onboarding.schema";
import { updateOrganizationSchema } from "./organization.schema";
import {
  updateNotificationPrefsSchema,
  updateProfileSchema,
} from "./profile.schema";
import {
  createRoleSchema,
  duplicateRoleSchema,
  updateRoleSchema,
} from "./roles.schema";
import { statusTransitionSchema, updateTaskSchema } from "./tasks.schema";
import {
  acceptInvitationSchema,
  changeRoleSchema,
  inviteSchema,
  inviteSignupSchema,
  setDashboardAccessSchema,
} from "./team.schema";

// DEV-029 R3 — every client-input schema is .strict(): an unknown key must
// reject (400), not silently strip. Each case first proves the minimal valid
// payload parses (guards against a broken fixture passing vacuously), then
// that the same payload + one unknown key fails.

const UUID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-ABC";

type Parseable = { safeParse: (v: unknown) => { success: boolean } };

function expectStrict(schema: Parseable, valid: Record<string, unknown>) {
  expect(schema.safeParse(valid).success).toBe(true);
  expect(schema.safeParse({ ...valid, injected: "x" }).success).toBe(false);
}

describe("auth.schema strict inputs", () => {
  it("signinSchema rejects unknown keys", () => {
    expectStrict(signinSchema, { email: "user@example.com", password: "secret" });
  });
  it("signupSchema rejects unknown keys", () => {
    expectStrict(signupSchema, {
      email: "user@example.com",
      password: "12345678",
      fullName: "שם מלא",
    });
  });
  it("forgotPasswordSchema rejects unknown keys", () => {
    expectStrict(forgotPasswordSchema, { email: "user@example.com" });
  });
  it("resetPasswordSchema rejects unknown keys", () => {
    expectStrict(resetPasswordSchema, {
      password: "12345678",
      confirmPassword: "12345678",
    });
  });
  it("changePasswordSchema rejects unknown keys", () => {
    expectStrict(changePasswordSchema, {
      currentPassword: "oldpass123",
      newPassword: "newpass123",
      confirmPassword: "newpass123",
    });
  });
  it("mfaConfirmSchema rejects unknown keys", () => {
    expectStrict(mfaConfirmSchema, { factorId: UUID, code: "123456" });
  });
  it("mfaVerifySchema rejects unknown keys", () => {
    expectStrict(mfaVerifySchema, { code: "123456" });
  });
});

describe("onboarding / active-org / locale strict inputs", () => {
  it("bootstrapOrgSchema rejects unknown keys", () => {
    expectStrict(bootstrapOrgSchema, {
      orgName: "משרד רואי חשבון",
      orgCode: "ABC-123",
      fullName: "לירן רז",
    });
  });
  it("setActiveOrgSchema rejects unknown keys", () => {
    expectStrict(setActiveOrgSchema, { orgId: UUID });
  });
  it("setLocaleSchema rejects unknown keys", () => {
    expectStrict(setLocaleSchema, { locale: "he" });
  });
});

describe("profile / organization strict inputs", () => {
  it("updateProfileSchema rejects unknown keys", () => {
    expectStrict(updateProfileSchema, { fullName: "שם" });
  });
  it("updateNotificationPrefsSchema rejects unknown keys", () => {
    expectStrict(updateNotificationPrefsSchema, { emailOnTaskAssignment: true });
  });
  it("updateOrganizationSchema rejects unknown keys", () => {
    expectStrict(updateOrganizationSchema, { name: "משרד" });
  });
});

describe("team.schema strict inputs", () => {
  it("inviteSchema rejects unknown keys", () => {
    expectStrict(inviteSchema, { email: "user@example.com", role: "employee" });
  });
  it("changeRoleSchema rejects unknown keys", () => {
    expectStrict(changeRoleSchema, { role: "admin" });
  });
  it("setDashboardAccessSchema rejects unknown keys", () => {
    expectStrict(setDashboardAccessSchema, { enabled: true });
  });
  it("acceptInvitationSchema rejects unknown keys", () => {
    expectStrict(acceptInvitationSchema, { token: TOKEN });
  });
  it("inviteSignupSchema rejects unknown keys", () => {
    expectStrict(inviteSignupSchema, {
      token: TOKEN,
      password: "12345678",
      fullName: "עובד חדש",
    });
  });
});

describe("clients / client-contacts strict inputs", () => {
  it("createClientSchema rejects unknown keys", () => {
    expectStrict(createClientSchema, { name: "לקוח" });
  });
  it("updateClientSchema rejects unknown keys", () => {
    expectStrict(updateClientSchema, { name: "לקוח" });
  });
  it("createContactSchema rejects unknown keys", () => {
    expectStrict(createContactSchema, { name: "איש קשר" });
  });
  it("updateContactSchema rejects unknown keys", () => {
    expectStrict(updateContactSchema, { name: "איש קשר" });
  });
});

describe("tasks.schema strict inputs", () => {
  // createTaskSchema is deliberately NOT strict — a stale client may still
  // send the legacy `status` key (stripped; pinned in tasks.schema.test.ts).
  it("updateTaskSchema rejects unknown keys", () => {
    expectStrict(updateTaskSchema, { title: "משימה" });
  });
  it("statusTransitionSchema rejects unknown keys", () => {
    expectStrict(statusTransitionSchema, { status: "in_progress" });
  });
});

describe("conversations / messages strict inputs", () => {
  it("createGroupSchema rejects unknown keys", () => {
    expectStrict(createGroupSchema, { title: "צוות" });
  });
  it("renameGroupSchema rejects unknown keys", () => {
    expectStrict(renameGroupSchema, { title: "שם חדש" });
  });
  it("addGroupMemberSchema rejects unknown keys", () => {
    expectStrict(addGroupMemberSchema, { userId: UUID });
  });
  it("sendMessageSchema rejects unknown keys", () => {
    expectStrict(sendMessageSchema, { body: "שלום" });
  });
  it("listMessagesQuerySchema rejects unknown keys", () => {
    expectStrict(listMessagesQuerySchema, { with: "group" });
  });
  it("markReadSchema rejects unknown keys", () => {
    expectStrict(markReadSchema, { with: "group" });
  });
  it("editMessageSchema rejects unknown keys", () => {
    expectStrict(editMessageSchema, { body: "עריכה" });
  });
});

describe("roles.schema strict inputs", () => {
  const baseRole = {
    name: "Bookkeeper",
    description: null,
    permissions: [{ permissionKey: "clients.view", recordScope: "all" }],
  };

  it("createRoleSchema rejects unknown keys", () => {
    expectStrict(createRoleSchema, baseRole);
  });
  it("createRoleSchema rejects an unknown key inside a grant", () => {
    expect(
      createRoleSchema.safeParse({
        ...baseRole,
        permissions: [
          { permissionKey: "clients.view", recordScope: "all", injected: "x" },
        ],
      }).success,
    ).toBe(false);
  });
  it("updateRoleSchema rejects unknown keys", () => {
    expectStrict(updateRoleSchema, {
      ...baseRole,
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });
  });
  it("duplicateRoleSchema rejects unknown keys", () => {
    expectStrict(duplicateRoleSchema, { name: "Copy" });
  });
});

describe("bug-reports.schema strict inputs", () => {
  const baseReport = {
    description: "תקלה",
    attemptedAction: null,
    pageUrl: "/tasks",
  };

  it("createBugReportSchema rejects unknown keys", () => {
    expectStrict(createBugReportSchema, baseReport);
  });
  it("rejects an unknown key inside clientLogs", () => {
    expect(
      createBugReportSchema.safeParse({
        ...baseReport,
        clientLogs: {
          consoleErrors: [],
          failedRequests: [],
          actionTrail: [],
          injected: "x",
        },
      }).success,
    ).toBe(false);
  });
  it("rejects an unknown key inside a clientLogs entry", () => {
    const logs = (entryExtra: Record<string, unknown>) => ({
      ...baseReport,
      clientLogs: {
        consoleErrors: [
          { message: "boom", timestamp: "2026-01-01T00:00:00.000Z", ...entryExtra },
        ],
        failedRequests: [],
        actionTrail: [],
      },
    });
    expect(createBugReportSchema.safeParse(logs({})).success).toBe(true);
    expect(createBugReportSchema.safeParse(logs({ injected: "x" })).success).toBe(false);
  });
});

describe("documents.schema strict inputs", () => {
  const baseDoc = {
    ledgerId: UUID,
    docType: "305",
    buyerName: "קונה",
    docDate: "2026-01-15",
  };
  const line = { description: "שירות", quantity: 1, unitPrice: 10000 };
  const payment = { method: 1, amount: 5000 };

  it("createDocumentSchema rejects unknown keys", () => {
    expectStrict(createDocumentSchema, baseDoc);
  });
  it("createDocumentSchema rejects an unknown key inside a line", () => {
    expect(
      createDocumentSchema.safeParse({ ...baseDoc, lines: [line] }).success,
    ).toBe(true);
    expect(
      createDocumentSchema.safeParse({
        ...baseDoc,
        lines: [{ ...line, injected: "x" }],
      }).success,
    ).toBe(false);
  });
  it("createDocumentSchema rejects an unknown key inside a payment", () => {
    expect(
      createDocumentSchema.safeParse({ ...baseDoc, payments: [payment] }).success,
    ).toBe(true);
    expect(
      createDocumentSchema.safeParse({
        ...baseDoc,
        payments: [{ ...payment, injected: "x" }],
      }).success,
    ).toBe(false);
  });
  it("updateDocumentSchema rejects unknown keys", () => {
    expectStrict(updateDocumentSchema, { docDate: "2026-01-16" });
  });
  it("cancelDocumentSchema rejects unknown keys", () => {
    expectStrict(cancelDocumentSchema, { reason: "הופק בטעות" });
  });
});

describe("ledgers.schema strict inputs", () => {
  it("updateLedgerSchema rejects unknown keys", () => {
    expectStrict(updateLedgerSchema, { legalName: 'עוסק בע"מ' });
  });
});
