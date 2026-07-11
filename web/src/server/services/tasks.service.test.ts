import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmailDeliveryError } from "@/server/email/email-errors";
import type { FullSession } from "@/server/auth/session";
import type { Task } from "@/server/db/domain.types";
import type { UserRole } from "@/server/db/domain.types";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";

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
  setStatus: vi.fn(),
  setArchived: vi.fn(),
  setDeleted: vi.fn(),
  getBoardVersion: vi.fn(),
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
import * as tasksRepo from "@/server/repositories/tasks.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import * as clientsRepo from "@/server/repositories/clients.repository";
import { sendTaskAssignmentEmail } from "@/server/services/emails.service";
import {
  archiveTask,
  createTask,
  deleteTask,
  getBoardVersion,
  getTask,
  listTasks,
  restoreTask,
  sendAssignmentEmailIfNeeded,
  transitionStatus,
  unarchiveTask,
  updateTask,
} from "@/server/services/tasks.service";

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
  task_number: 42,
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

// ============================================================
// Phase 4 — task authorization (permission-wired, behavior-preserving)
// ============================================================

function makeSession(role: UserRole, userId = `${role}-user`): FullSession {
  return {
    user: { id: userId },
    profile: { id: userId, role, full_name: "U", email: "u@x.test" },
    organization: { id: "org-1", name: "Org" },
    activeOrg: { id: "org-1" },
    activeRole: role,
  } as unknown as FullSession;
}

function taskRow(assignedTo: string | null = null): Task {
  return {
    id: "task-123",
    task_number: 7,
    org_id: "org-1",
    creator_id: "creator-profile",
    title: "T",
    description: null,
    due_at: "2026-07-01T00:00:00.000Z",
    status: "new",
    priority: "normal",
    assigned_to: assignedTo,
    client_id: null,
    completed_at: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:00:00.000Z",
  } as unknown as Task;
}

const ROLES = ["owner", "admin", "employee"] as const;

describe("Phase 4 — task authorization (all roles retain current behavior)", () => {
  beforeEach(() => {
    vi.mocked(tasksRepo.findManyByOrgId).mockResolvedValue([]);
    vi.mocked(tasksRepo.findByIdAndOrgId).mockResolvedValue(taskRow());
    vi.mocked(tasksRepo.create).mockResolvedValue(taskRow());
    vi.mocked(tasksRepo.updateByIdAndOrgId).mockResolvedValue(taskRow());
    vi.mocked(tasksRepo.setStatus).mockResolvedValue(taskRow());
    vi.mocked(tasksRepo.setArchived).mockResolvedValue(taskRow());
    vi.mocked(tasksRepo.setDeleted).mockResolvedValue(taskRow());
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({
      is_active: true,
    } as unknown as Awaited<ReturnType<typeof membershipsRepo.findByUserAndOrg>>);
    vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue({
      id: "cl1",
      org_id: "org-1",
    } as unknown as Awaited<ReturnType<typeof clientsRepo.findByIdAndOrgId>>);
    vi.mocked(sendTaskAssignmentEmail).mockResolvedValue(undefined);
  });

  const q = { lifecycle: "all", limit: 50, offset: 0 } as unknown as Parameters<
    typeof listTasks
  >[1];

  describe("view", () => {
    it.each(ROLES)("%s can list (org-scoped)", async (role) => {
      await expect(listTasks(makeSession(role), q)).resolves.toEqual({
        items: [],
      });
      expect(tasksRepo.findManyByOrgId).toHaveBeenCalledWith(
        "org-1",
        expect.anything(),
      );
    });
    it.each(ROLES)("%s can get a task", async (role) => {
      const dto = await getTask(makeSession(role), "task-123");
      expect(dto.id).toBe("task-123");
    });
    it("get of a cross-org / non-existent task → NotFound", async () => {
      vi.mocked(tasksRepo.findByIdAndOrgId).mockResolvedValue(null);
      await expect(getTask(makeSession("owner"), "ghost")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe("create", () => {
    it.each(ROLES)("%s can create (unassigned)", async (role) => {
      const dto = await createTask(makeSession(role), {
        title: "X",
        dueAt: "2026-07-01T00:00:00.000Z",
      } as Parameters<typeof createTask>[1]);
      expect(dto.id).toBe("task-123");
    });
    it.each(ROLES)("%s can create assigned to another active member", async (role) => {
      await expect(
        createTask(makeSession(role), {
          title: "X",
          dueAt: "2026-07-01T00:00:00.000Z",
          assignedTo: "someone-else",
        } as Parameters<typeof createTask>[1]),
      ).resolves.toBeDefined();
    });
    it("cross-org assignee → ValidationError", async () => {
      vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue(null);
      await expect(
        createTask(makeSession("owner"), {
          title: "X",
          dueAt: "2026-07-01T00:00:00.000Z",
          assignedTo: "foreign-user",
        } as Parameters<typeof createTask>[1]),
      ).rejects.toBeInstanceOf(ValidationError);
    });
    it("inactive assignee → ValidationError", async () => {
      vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({
        is_active: false,
      } as unknown as Awaited<ReturnType<typeof membershipsRepo.findByUserAndOrg>>);
      await expect(
        createTask(makeSession("owner"), {
          title: "X",
          dueAt: "2026-07-01T00:00:00.000Z",
          assignedTo: "inactive-user",
        } as Parameters<typeof createTask>[1]),
      ).rejects.toBeInstanceOf(ValidationError);
    });
    it("cross-org client linkage → ValidationError", async () => {
      vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue(null);
      await expect(
        createTask(makeSession("owner"), {
          title: "X",
          dueAt: "2026-07-01T00:00:00.000Z",
          clientId: "foreign-client",
        } as Parameters<typeof createTask>[1]),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("edit & assignment", () => {
    it.each(ROLES)("%s can edit", async (role) => {
      const dto = await updateTask(makeSession(role), "task-123", {
        title: "Y",
      } as Parameters<typeof updateTask>[2]);
      expect(dto.id).toBe("task-123");
    });
    it("edit of a non-existent task → NotFound", async () => {
      vi.mocked(tasksRepo.findByIdAndOrgId).mockResolvedValue(null);
      await expect(
        updateTask(makeSession("owner"), "ghost", {} as Parameters<
          typeof updateTask
        >[2]),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
    it.each(ROLES)("%s can assign to self (assign_self)", async (role) => {
      const s = makeSession(role);
      await expect(
        updateTask(s, "task-123", { assignedTo: s.profile.id } as Parameters<
          typeof updateTask
        >[2]),
      ).resolves.toBeDefined();
    });
    it.each(ROLES)(
      "%s can assign to another active member (assign_others — Phase 4 compatibility)",
      async (role) => {
        await expect(
          updateTask(makeSession(role), "task-123", {
            assignedTo: "someone-else",
          } as Parameters<typeof updateTask>[2]),
        ).resolves.toBeDefined();
      },
    );
    it("clearing assignment (assignedTo=null) is allowed and needs no assign permission", async () => {
      await expect(
        updateTask(makeSession("employee"), "task-123", {
          assignedTo: null,
        } as Parameters<typeof updateTask>[2]),
      ).resolves.toBeDefined();
    });
    it("assigning a cross-org target → ValidationError", async () => {
      vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue(null);
      await expect(
        updateTask(makeSession("owner"), "task-123", {
          assignedTo: "foreign-user",
        } as Parameters<typeof updateTask>[2]),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("lifecycle (status / archive / delete) — all roles", () => {
    it.each(ROLES)("%s can change status", async (role) => {
      const dto = await transitionStatus(makeSession(role), "task-123", "done");
      expect(dto.id).toBe("task-123");
    });
    it.each(ROLES)("%s can archive and unarchive", async (role) => {
      await expect(archiveTask(makeSession(role), "task-123")).resolves.toBeDefined();
      await expect(
        unarchiveTask(makeSession(role), "task-123"),
      ).resolves.toBeDefined();
    });
    it.each(ROLES)("%s can delete and restore (soft)", async (role) => {
      await expect(deleteTask(makeSession(role), "task-123")).resolves.toBeDefined();
      await expect(
        restoreTask(makeSession(role), "task-123"),
      ).resolves.toBeDefined();
    });
    it("status change on a non-existent task → NotFound", async () => {
      vi.mocked(tasksRepo.findByIdAndOrgId).mockResolvedValue(null);
      await expect(
        transitionStatus(makeSession("owner"), "ghost", "done"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

// ============================================================
// Stage 12 Round B — create defaults + DTO exposure
// ============================================================

describe("Round B — create forces status + exposes new DTO fields", () => {
  beforeEach(() => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({
      is_active: true,
    } as unknown as Awaited<ReturnType<typeof membershipsRepo.findByUserAndOrg>>);
    vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue({
      id: "cl1",
      org_id: "org-1",
    } as unknown as Awaited<ReturnType<typeof clientsRepo.findByIdAndOrgId>>);
    vi.mocked(sendTaskAssignmentEmail).mockResolvedValue(undefined);
    // Echo the insert back as the stored row so the DTO can be inspected.
    vi.mocked(tasksRepo.create).mockImplementation(
      async (input) =>
        ({ ...taskRow(), ...input, task_number: 7 }) as unknown as Task,
    );
  });

  it("forces status 'new' and persists a null due date", async () => {
    const dto = await createTask(makeSession("owner"), {
      title: "X",
      dueAt: null,
      assignedTo: "owner-user", // self-assign (== creator)
    } as Parameters<typeof createTask>[1]);

    const createArg = vi.mocked(tasksRepo.create).mock.calls[0]?.[0] as
      | { status: string; due_at: string | null }
      | undefined;
    expect(createArg?.status).toBe("new");
    expect(createArg?.due_at).toBeNull();

    // DTO exposes the Stage 12 fields.
    expect(dto.dueAt).toBeNull();
    expect(dto.taskNumber).toBe(7);
    expect(dto.creatorId).toBe("owner-user");
  });

  it("self-assignment sends no assignment email", async () => {
    const s = makeSession("owner"); // owner-user == creator
    await createTask(s, {
      title: "X",
      assignedTo: s.profile.id,
    } as Parameters<typeof createTask>[1]);
    expect(sendTaskAssignmentEmail).not.toHaveBeenCalled();
  });
});

// ============================================================
// Stage 12 Round C — personal-board authorization
// ============================================================

describe("Round C — personal board authorization", () => {
  beforeEach(() => {
    vi.mocked(tasksRepo.findManyByOrgId).mockResolvedValue([]);
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({
      is_active: true,
    } as unknown as Awaited<ReturnType<typeof membershipsRepo.findByUserAndOrg>>);
  });

  const boardQuery = (boardFor: string) =>
    ({
      lifecycle: "active",
      boardFor,
      limit: 50,
      offset: 0,
    }) as unknown as Parameters<typeof listTasks>[1];

  it.each(ROLES)("%s can view their OWN board", async (role) => {
    const s = makeSession(role);
    await expect(listTasks(s, boardQuery(s.profile.id))).resolves.toEqual({
      items: [],
    });
  });

  it("an employee CANNOT view another member's board → Forbidden", async () => {
    await expect(
      listTasks(makeSession("employee"), boardQuery("someone-else")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each(["owner", "admin"] as const)(
    "%s can view another member's board",
    async (role) => {
      await expect(
        listTasks(makeSession(role), boardQuery("someone-else")),
      ).resolves.toEqual({ items: [] });
    },
  );

  it("owner viewing a NON-member's board → ValidationError", async () => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue(null);
    await expect(
      listTasks(makeSession("owner"), boardQuery("ghost-user")),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ============================================================
// Stage 13 — live board version signal
// ============================================================

describe("getBoardVersion — org-scoped change signal", () => {
  it("returns the repo's version string for the caller's org", async () => {
    vi.mocked(tasksRepo.getBoardVersion).mockResolvedValue(
      "5:2026-07-11T00:00:00.000Z",
    );
    await expect(getBoardVersion(makeSession("employee"))).resolves.toEqual({
      version: "5:2026-07-11T00:00:00.000Z",
    });
    expect(tasksRepo.getBoardVersion).toHaveBeenCalledWith("org-1");
  });
});
