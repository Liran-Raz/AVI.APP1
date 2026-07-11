import "server-only";

import type { FullSession } from "@/server/auth/session";
import {
  requirePermission,
  resolveListScope,
} from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import * as tasksRepo from "@/server/repositories/tasks.repository";
import * as profileRepo from "@/server/repositories/profile.repository";
import * as clientsRepo from "@/server/repositories/clients.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import { env } from "@/server/env";
import { sendTaskAssignmentEmail } from "@/server/services/emails.service";
import { readNotificationPrefs } from "@/server/services/profile.service";
import { toSafeErrorMeta } from "@/server/email/email-errors";
import type { Database } from "@/server/db/database.types";
import type {
  Task,
  TaskPriority,
  TaskStatus,
} from "@/server/db/domain.types";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";
import type {
  CreateTaskPayload,
  ListTasksQuery,
  UpdateTaskPayload,
} from "@/server/validators/tasks.schema";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

// ============================================================
// DTO — what the API exposes to the client.
// Strips org_id (implicit — the caller's own org). Exposes creatorId and the
// per-org taskNumber (Stage 12): the personal board groups by creator/assignee
// and the card shows #NNNN. Field names are camelCase, ISO timestamps as
// strings; dueAt is nullable (the due date is optional).
// ============================================================

export type TaskDTO = {
  id: string;
  taskNumber: number;
  title: string;
  description: string | null;
  dueAt: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo: string | null;
  creatorId: string;
  clientId: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toDTO(row: Task): TaskDTO {
  return {
    id: row.id,
    taskNumber: row.task_number,
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assigned_to,
    creatorId: row.creator_id,
    clientId: row.client_id,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Authorization (the service is the authoritative layer)
// ============================================================
//
// Tasks are operable by every active org member (no role distinction in the
// current product policy). Phase 4 makes this EXPLICIT through the centralized
// permission system instead of leaving it implicit: each operation calls
// requirePermission against a SERVER-LOADED task context. Because all roles
// hold every task permission at scope "all", behavior is preserved.
//
// Assignment is governed by DISTINCT permissions (tasks.assign_self /
// tasks.assign_others) — never folded into recordScope. Phase 4 grants both
// to all roles (compatibility); the future Employee→self-only restriction will
// flip only the assign_others grant in a separate, approved PR.

function taskContext(task: Task): {
  orgId: string;
  creatorId: string;
  assigneeId: string | null;
} {
  return {
    orgId: task.org_id,
    creatorId: task.creator_id,
    assigneeId: task.assigned_to,
  };
}

async function loadTaskInOrg(session: FullSession, id: string): Promise<Task> {
  const task = await tasksRepo.findByIdAndOrgId(id, session.organization.id);
  if (!task) throw new NotFoundError("Task not found");
  return task;
}

// Assignment authorization. The target's active membership in the active org
// is validated by assertAssignmentRefsInOrg BEFORE this runs, so the active /
// same-org facts are server-trusted here (never client-supplied).
function requireAssignmentPermission(
  session: FullSession,
  assignedTo: string,
): void {
  const permission =
    assignedTo === session.profile.id
      ? PERMISSIONS.TASKS_ASSIGN_SELF
      : PERMISSIONS.TASKS_ASSIGN_OTHERS;
  requirePermission(session, permission, {
    orgId: session.organization.id,
    targetAssigneeId: assignedTo,
    targetAssigneeActive: true,
    targetAssigneeOrgId: session.organization.id,
  });
}

// ============================================================
// F1 — cross-org reference guard
// ============================================================
//
// `assignedTo` and `clientId` arrive from the client validated only for
// UUID shape (tasks.schema). Without an org check a member of org A could
// plant a task in their OWN org that references an org-B user (firing a
// cross-tenant assignment notification via the DB trigger) or an org-B
// client (a dangling cross-tenant reference). Both lookups below are scoped
// to the caller's active org, so they neither accept a foreign reference
// nor reveal whether the id exists in another org. Only keys the caller
// actually set are checked (null/undefined = unassign/untouched = allowed).

async function assertAssignmentRefsInOrg(
  session: FullSession,
  refs: { assignedTo?: string | null; clientId?: string | null },
): Promise<void> {
  const orgId = session.organization.id;

  if (refs.assignedTo) {
    const membership = await membershipsRepo.findByUserAndOrg(
      refs.assignedTo,
      orgId,
    );
    if (!membership || !membership.is_active) {
      throw new ValidationError(
        "Assigned user is not an active member of this organization",
      );
    }
  }

  if (refs.clientId) {
    const client = await clientsRepo.findByIdAndOrgId(refs.clientId, orgId);
    if (!client) {
      throw new ValidationError(
        "Client does not belong to this organization",
      );
    }
  }
}

export async function listTasks(
  session: FullSession,
  query: ListTasksQuery,
): Promise<{ items: TaskDTO[] }> {
  // Collection authorization: requires tasks.view at a supported scope.
  // Phase 4 supports only "all" (assigned/team fail closed) → list all.
  resolveListScope(session, PERMISSIONS.TASKS_VIEW);

  // Personal-board gate (Stage 12 Round C). Everyone may view their OWN board;
  // viewing ANOTHER member's board is owner/admin-only, and the target must be
  // a member of this org. Gated on the ENUM activeRole (a relational check),
  // NOT a grantable permission key — so it stays correct if authorization ever
  // becomes DB-authoritative (that map would not carry a "view others' board"
  // permission). Precedent: the owner/admin protected-action checks.
  if (query.boardFor && query.boardFor !== session.profile.id) {
    if (session.activeRole !== "owner" && session.activeRole !== "admin") {
      throw new ForbiddenError(
        "Only an owner or manager can view another member's board",
      );
    }
    const membership = await membershipsRepo.findByUserAndOrg(
      query.boardFor,
      session.organization.id,
    );
    if (!membership) {
      throw new ValidationError(
        "Target user is not a member of this organization",
      );
    }
  }

  const rows = await tasksRepo.findManyByOrgId(session.organization.id, {
    search: query.search,
    status: query.status,
    priority: query.priority,
    assignedTo: query.assignedTo,
    clientId: query.clientId,
    lifecycle: query.lifecycle,
    dueBefore: query.dueBefore,
    dueAfter: query.dueAfter,
    boardFor: query.boardFor,
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toDTO) };
}

// Cheap change-signal for live board polling (Stage 13 R6). Org-scoped; any
// active member may poll their own org. Returns a small opaque version string
// that changes whenever any task in the org changes — the client refetches its
// board only when the string changes, keeping frequent polling near-free.
export async function getBoardVersion(
  session: FullSession,
): Promise<{ version: string }> {
  resolveListScope(session, PERMISSIONS.TASKS_VIEW);
  const version = await tasksRepo.getBoardVersion(session.organization.id);
  return { version };
}

export async function getTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  const row = await loadTaskInOrg(session, id);
  requirePermission(session, PERMISSIONS.TASKS_VIEW, taskContext(row));
  return toDTO(row);
}

export async function createTask(
  session: FullSession,
  input: CreateTaskPayload,
): Promise<TaskDTO> {
  requirePermission(session, PERMISSIONS.TASKS_CREATE);
  // F1: reject cross-org assignee/client references before creating.
  await assertAssignmentRefsInOrg(session, {
    assignedTo: input.assignedTo ?? null,
    clientId: input.clientId ?? null,
  });
  if (input.assignedTo) requireAssignmentPermission(session, input.assignedTo);

  const row = await tasksRepo.create({
    org_id: session.organization.id,
    creator_id: session.profile.id,
    title: input.title,
    description: input.description ?? null,
    due_at: input.dueAt ?? null,
    // Every new task starts in the assignee's "new" queue (Round B removed the
    // status field from the form). task_number is allocated by the DB trigger.
    status: "new",
    priority: input.priority ?? "normal",
    assigned_to: input.assignedTo ?? null,
    client_id: input.clientId ?? null,
  });
  // Fire-and-forget email if the new task was assigned to someone
  // other than its creator. Failures are logged but never fail the
  // create — the task is already in the DB, the in-app notification
  // trigger has fired, this is just the email belt.
  void sendAssignmentEmailIfNeeded(session, row, /*previousAssignedTo*/ null);
  return toDTO(row);
}

export async function updateTask(
  session: FullSession,
  id: string,
  patch: UpdateTaskPayload,
): Promise<TaskDTO> {
  // F1: reject cross-org assignee/client references before any read/write.
  await assertAssignmentRefsInOrg(session, {
    assignedTo: patch.assignedTo,
    clientId: patch.clientId,
  });

  // Load the task (org-scoped) for a trusted authorization context.
  const before = await loadTaskInOrg(session, id);
  requirePermission(session, PERMISSIONS.TASKS_EDIT, taskContext(before));
  // Assigning to a (non-null) user requires the relevant assignment permission.
  if (patch.assignedTo) requireAssignmentPermission(session, patch.assignedTo);
  const previousAssignedTo = before.assigned_to;

  // Build a snake_case partial. Only include keys the caller sent.
  const dbPatch: TaskUpdate = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.dueAt !== undefined) dbPatch.due_at = patch.dueAt;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.priority !== undefined) dbPatch.priority = patch.priority;
  if (patch.assignedTo !== undefined) dbPatch.assigned_to = patch.assignedTo;
  if (patch.clientId !== undefined) dbPatch.client_id = patch.clientId;

  const row = await tasksRepo.updateByIdAndOrgId(
    id,
    session.organization.id,
    dbPatch,
  );
  if (!row) throw new NotFoundError("Task not found");

  if (patch.assignedTo !== undefined) {
    void sendAssignmentEmailIfNeeded(session, row, previousAssignedTo);
  }
  return toDTO(row);
}

// ============================================================
// Assignment email helper
// ============================================================
//
// Sends a "you have a new task" email to the assignee when:
//   - assigned_to is non-null AFTER the operation, AND
//   - it changed (or it's a brand-new task with someone assigned), AND
//   - the assignee is NOT the creator (self-assignment is silent).
//
// Errors are caught + logged so the surrounding task operation never
// fails because email is misconfigured (best-effort: the in-app
// notification is the primary channel). In dev without RESEND_API_KEY the
// console adapter logs the would-be send; in production a missing config
// now fails loudly (the adapter throws) and is recorded here as an error.
//
// Exported for unit testing the best-effort failure path. The call sites
// keep invoking it fire-and-forget; exporting does not change the flow.
export async function sendAssignmentEmailIfNeeded(
  session: FullSession,
  task: Task,
  previousAssignedTo: string | null,
): Promise<void> {
  try {
    const newAssigned = task.assigned_to;
    if (!newAssigned) return;
    if (newAssigned === previousAssignedTo) return;
    if (newAssigned === session.profile.id) return; // self-assignment

    const assignee = await profileRepo.findByUserId(newAssigned);
    if (!assignee || !assignee.email) return;

    // Respect the assignee's notification preference (Settings → התראות).
    // Absent/unset prefs default to ON (see readNotificationPrefs). The
    // in-app notification (DB trigger) is unaffected — only the email opts out.
    if (!readNotificationPrefs(assignee.notification_prefs).emailOnTaskAssignment) {
      return;
    }

    const taskUrl = `${env.NEXT_PUBLIC_SITE_URL}/tasks`;

    await sendTaskAssignmentEmail({
      toEmail: assignee.email,
      assigneeName: assignee.full_name,
      taskTitle: task.title,
      taskDescription: task.description,
      dueAt: task.due_at,
      creatorName: session.profile.full_name,
      taskUrl,
    });
  } catch (err) {
    // Log ONLY the task id plus stable, allowlisted metadata via
    // toSafeErrorMeta — never err.message/stack, recipient, task content,
    // or any provider body.
    console.error("[tasks] assignment email send failed", {
      taskId: task.id,
      ...toSafeErrorMeta(err),
    });
  }
}

export async function transitionStatus(
  session: FullSession,
  id: string,
  status: TaskStatus,
): Promise<TaskDTO> {
  const before = await loadTaskInOrg(session, id);
  requirePermission(session, PERMISSIONS.TASKS_CHANGE_STATUS, taskContext(before));
  const row = await tasksRepo.setStatus(id, session.organization.id, status);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}

export async function archiveTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  const before = await loadTaskInOrg(session, id);
  requirePermission(session, PERMISSIONS.TASKS_ARCHIVE, taskContext(before));
  const row = await tasksRepo.setArchived(id, session.organization.id, true);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}

export async function unarchiveTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  const before = await loadTaskInOrg(session, id);
  requirePermission(session, PERMISSIONS.TASKS_ARCHIVE, taskContext(before));
  const row = await tasksRepo.setArchived(id, session.organization.id, false);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}

export async function deleteTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  const before = await loadTaskInOrg(session, id);
  requirePermission(session, PERMISSIONS.TASKS_DELETE, taskContext(before));
  const row = await tasksRepo.setDeleted(id, session.organization.id, true);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}

export async function restoreTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  // Restore (clear deleted_at) is governed by the same capability as delete
  // (managing the recycle-bin state).
  const before = await loadTaskInOrg(session, id);
  requirePermission(session, PERMISSIONS.TASKS_DELETE, taskContext(before));
  const row = await tasksRepo.setDeleted(id, session.organization.id, false);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}
