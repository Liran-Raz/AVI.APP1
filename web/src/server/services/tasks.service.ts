import "server-only";

import type { FullSession } from "@/server/auth/session";
import * as tasksRepo from "@/server/repositories/tasks.repository";
import * as profileRepo from "@/server/repositories/profile.repository";
import { env } from "@/server/env";
import { sendTaskAssignmentEmail } from "@/server/services/emails.service";
import type {
  Database,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/server/db/database.types";
import { NotFoundError } from "@/server/errors/app-error";
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
// fails because email is misconfigured. Without RESEND_API_KEY this
// just logs to the server console via the console adapter.

async function sendAssignmentEmailIfNeeded(
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
    console.error("[tasks] failed to send assignment email", err);
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
