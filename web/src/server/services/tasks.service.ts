import "server-only";

import type { FullSession } from "@/server/auth/session";
import * as tasksRepo from "@/server/repositories/tasks.repository";
import * as profileRepo from "@/server/repositories/profile.repository";
import * as clientsRepo from "@/server/repositories/clients.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import { env } from "@/server/env";
import { sendTaskAssignmentEmail } from "@/server/services/emails.service";
import { toSafeErrorMeta } from "@/server/email/email-errors";
import type {
  Database,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/server/db/database.types";
import { NotFoundError, ValidationError } from "@/server/errors/app-error";
import type {
  CreateTaskPayload,
  ListTasksQuery,
  UpdateTaskPayload,
} from "@/server/validators/tasks.schema";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

// ============================================================
// DTO — what the API exposes to the client.
// Strips org_id (implicit — caller's own org) and creator_id (audit
// only). Field names are camelCase, ISO timestamps as strings.
// ============================================================

export type TaskDTO = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo: string | null;
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
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assigned_to,
    clientId: row.client_id,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Public API
// ============================================================
//
// Per product decision (2026-05-17): no role gating on tasks. Any
// authenticated org member can create, update, transition, archive,
// delete, restore, and reassign any task in their own org.

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
  const rows = await tasksRepo.findManyByOrgId(session.organization.id, {
    search: query.search,
    status: query.status,
    priority: query.priority,
    assignedTo: query.assignedTo,
    clientId: query.clientId,
    lifecycle: query.lifecycle,
    dueBefore: query.dueBefore,
    dueAfter: query.dueAfter,
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toDTO) };
}

export async function getTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  const row = await tasksRepo.findByIdAndOrgId(id, session.organization.id);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}

export async function createTask(
  session: FullSession,
  input: CreateTaskPayload,
): Promise<TaskDTO> {
  // F1: reject cross-org assignee/client references before creating.
  await assertAssignmentRefsInOrg(session, {
    assignedTo: input.assignedTo ?? null,
    clientId: input.clientId ?? null,
  });
  const row = await tasksRepo.create({
    org_id: session.organization.id,
    creator_id: session.profile.id,
    title: input.title,
    description: input.description ?? null,
    due_at: input.dueAt,
    status: input.status ?? "new",
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

  // Build a snake_case partial. Only include keys the caller sent.
  const dbPatch: TaskUpdate = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.dueAt !== undefined) dbPatch.due_at = patch.dueAt;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.priority !== undefined) dbPatch.priority = patch.priority;
  if (patch.assignedTo !== undefined) dbPatch.assigned_to = patch.assignedTo;
  if (patch.clientId !== undefined) dbPatch.client_id = patch.clientId;

  // If assigned_to is changing, peek at the previous value so the
  // email helper can decide whether this counts as a real reassignment
  // (vs. an update that doesn't touch assignment).
  let previousAssignedTo: string | null = null;
  if (patch.assignedTo !== undefined) {
    const before = await tasksRepo.findByIdAndOrgId(
      id,
      session.organization.id,
    );
    previousAssignedTo = before?.assigned_to ?? null;
  }

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
  const row = await tasksRepo.setStatus(id, session.organization.id, status);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}

export async function archiveTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  const row = await tasksRepo.setArchived(id, session.organization.id, true);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}

export async function unarchiveTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  const row = await tasksRepo.setArchived(id, session.organization.id, false);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}

export async function deleteTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  const row = await tasksRepo.setDeleted(id, session.organization.id, true);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}

export async function restoreTask(
  session: FullSession,
  id: string,
): Promise<TaskDTO> {
  const row = await tasksRepo.setDeleted(id, session.organization.id, false);
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
}
