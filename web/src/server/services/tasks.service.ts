import "server-only";

import type { FullSession } from "@/server/auth/session";
import * as tasksRepo from "@/server/repositories/tasks.repository";
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

  const row = await tasksRepo.updateByIdAndOrgId(
    id,
    session.organization.id,
    dbPatch,
  );
  if (!row) throw new NotFoundError("Task not found");
  return toDTO(row);
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
