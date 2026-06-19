import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmailDeliveryError } from "@/server/email/email-errors";
import type { FullSession } from "@/server/auth/session";
import type { Task } from "@/server/db/database.types";

// Mock all of tasks.service's heavy dependencies so importing it does not
// boot env validation or the Supabase client, and so we can drive the
// assignment-email outcome deterministically.
vi.mock("@/server/env", () => ({
  env: { NEXT_PUBLIC_SITE_URL: "https://app.example.test" },
}));
vi.mock("@/server/repositories/tasks.repository", () => ({
  create: vi.fn(),
  findByIdAndOrgId: vi.fn(),
  updateByIdAndOrgId: vi.fn(),
  findManyByOrgId: vi.fn(),
}));
vi.mock("@/server/repositories/profile.repository", () => ({
  findByUserId: vi.fn(),
}));
vi.mock("@/server/repositories/clients.repository", () => ({
  findByIdAndOrgId: vi.fn(),
}));
vi.mock("@/server/repositories/memberships.repository", () => ({
  findByUserAndOrg: vi.fn(),
}));
vi.mock("@/server/services/emails.service", () => ({
  sendTaskAssignmentEmail: vi.fn(),
}));

import * as profileRepo from "@/server/repositories/profile.repository";
import { sendTaskAssignmentEmail } from "@/server/services/emails.service";
import { sendAssignmentEmailIfNeeded } from "@/server/services/tasks.service";

const RECIPIENT = "recipient-secret@example.com";

const session = {
  user: { id: "creator-user" },
  profile: { id: "creator-profile", full_name: "Creator", role: "owner" },
  organization: { id: "org-1", name: "Org" },
  activeOrg: { id: "org-1" },
  activeRole: "owner",
} as unknown as FullSession;

const task = {
  id: "task-123",
  org_id: "org-1",
  creator_id: "creator-profile",
  title: "BODY_TITLE_SECRET",
  description: "BODY_DESCRIPTION_SECRET",
  due_at: "2026-07-01T00:00:00.000Z",
  status: "new",
  priority: "normal",
  assigned_to: "assignee-user",
  client_id: null,
  completed_at: null,
  archived_at: null,
  deleted_at: null,
  created_at: "2026-06-19T00:00:00.000Z",
  updated_at: "2026-06-19T00:00:00.000Z",
} as unknown as Task;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(profileRepo.findByUserId).mockResolvedValue({
    email: RECIPIENT,
    full_name: "Assignee Name",
  } as unknown as Awaited<ReturnType<typeof profileRepo.findByUserId>>);
});

describe("sendAssignmentEmailIfNeeded — best-effort failure handling", () => {
  it("a failed assignment email does not throw, is logged, and leaks nothing sensitive", async () => {
    vi.mocked(sendTaskAssignmentEmail).mockRejectedValue(
      new EmailDeliveryError({
        provider: "resend",
        status: 500,
        code: "internal_server_error",
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Best-effort: resolves (never rejects) → the surrounding task op is
    // unaffected and there is no unhandled rejection.
    await expect(
      sendAssignmentEmailIfNeeded(session, task, null),
    ).resolves.toBeUndefined();

    expect(sendTaskAssignmentEmail).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const [msg, meta] = errorSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(msg).toBe("[tasks] assignment email send failed");
    // Only the task id plus approved, stable metadata are logged.
    expect(meta).toEqual({
      taskId: "task-123",
      category: "delivery_error",
      provider: "resend",
      status: 500,
      providerCode: "internal_server_error",
    });

    // Nothing sensitive in the log: no recipient, no body, no token/secret.
    const logged = errorSpy.mock.calls
      .map((c: unknown[]) => JSON.stringify(c))
      .join(" ");
    expect(logged).not.toContain(RECIPIENT);
    expect(logged).not.toContain("BODY_TITLE_SECRET");
    expect(logged).not.toContain("BODY_DESCRIPTION_SECRET");
  });

  it("a malicious plain Error leaks nothing — logs taskId + unknown_error only", async () => {
    const apiKeyLike = "re_LEAK_SECRET_abc123";
    const tokenLike = "tok_live_SUPERSECRET";
    const providerBody = "<html>provider secret</html>";
    vi.mocked(sendTaskAssignmentEmail).mockRejectedValue(
      new Error(
        `to ${RECIPIENT} apikey=${apiKeyLike} token=${tokenLike} body=${providerBody} ${"BODY_TITLE_SECRET"}`,
      ),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendAssignmentEmailIfNeeded(session, task, null),
    ).resolves.toBeUndefined();

    const [, meta] = errorSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(meta).toEqual({ taskId: "task-123", category: "unknown_error" });

    const logged = errorSpy.mock.calls
      .map((c: unknown[]) => JSON.stringify(c))
      .join(" ");
    expect(logged).not.toContain(RECIPIENT);
    expect(logged).not.toContain(apiKeyLike);
    expect(logged).not.toContain(tokenLike);
    expect(logged).not.toContain(providerBody);
    expect(logged).not.toContain("BODY_TITLE_SECRET");
  });

  it("a successful assignment email logs no error", async () => {
    vi.mocked(sendTaskAssignmentEmail).mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendAssignmentEmailIfNeeded(session, task, null),
    ).resolves.toBeUndefined();

    expect(sendTaskAssignmentEmail).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
