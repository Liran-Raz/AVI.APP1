import { z } from "zod";

// Mirrors the DB enums.
export const TASK_STATUSES = [
  "new",
  "received",
  "in_progress",
  "done",
] as const;

export const TASK_PRIORITIES = ["urgent", "normal", "optional"] as const;

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

export type TaskStatusValue = z.infer<typeof taskStatusSchema>;
export type TaskPriorityValue = z.infer<typeof taskPrioritySchema>;

// Lifecycle filter values used by the list query. Composed in the
// repo from archived_at / deleted_at; the UI sends one of these.
export const LIFECYCLE_FILTERS = [
  "active",
  "archived",
  "deleted",
  "all",
] as const;
export const lifecycleSchema = z.enum(LIFECYCLE_FILTERS);
export type LifecycleFilter = z.infer<typeof lifecycleSchema>;

// ============================================================
// Field-level schemas
// ============================================================

const titleField = z
  .string()
  .trim()
  .min(1, "Task title is required")
  .max(200, "Task title is too long");

const descriptionField = z.string().trim().max(5000, "Description is too long");

// ISO 8601 datetime. zod 4 has z.iso.datetime() helper.
const dueAtField = z.string().trim().min(1, "Due date is required").refine(
  (v) => !Number.isNaN(Date.parse(v)),
  { message: "Due date must be a valid ISO datetime" },
);

const uuidNullableField = z.string().uuid("Invalid id");

// Optional + nullable: empty string and null both clear the field.
// Missing keys stay missing (PATCH-safe).
function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());
}

// ============================================================
// Create / Update payloads (JSON body)
// ============================================================

export const createTaskSchema = z.object({
  title: titleField,
  description: optionalNullable(descriptionField),
  // Optional due date (Round B "האם להוסיף תאריך יעד?"): null/omitted = none.
  dueAt: optionalNullable(dueAtField),
  // `status` is no longer a create input — every new task starts 'new'
  // (forced in the service). The enum contract (TASK_STATUSES) is untouched.
  priority: taskPrioritySchema.optional(), // default 'normal' is in the DB
  // Mandatory assignee (Round B). The UI defaults the picker to the creator.
  assignedTo: uuidNullableField,
  clientId: optionalNullable(uuidNullableField),
});

export const updateTaskSchema = z
  .object({
    title: titleField.optional(),
    description: optionalNullable(descriptionField),
    // Nullable on update too: unchecking "add a due date?" clears it.
    dueAt: optionalNullable(dueAtField),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assignedTo: optionalNullable(uuidNullableField),
    clientId: optionalNullable(uuidNullableField),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field is required for update",
  });

// Status transition is a focused endpoint — keeps the intent explicit
// vs a generic PATCH and makes the audit trail readable.
export const statusTransitionSchema = z.object({
  status: taskStatusSchema,
});

// ============================================================
// List query string
// ============================================================

// Free-text search. Same sanitization rules as clients (strip
// PostgREST .or() separators and ILIKE wildcards).
const searchField = z.preprocess(
  (v) => {
    if (typeof v !== "string") return undefined;
    const cleaned = v
      .trim()
      .replace(/[,()"'\\%_*]/g, "")
      .slice(0, 100);
    return cleaned.length > 0 ? cleaned : undefined;
  },
  z.string().min(1).max(100).optional(),
);

const lifecycleField = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? "active" : v),
  lifecycleSchema.default("active"),
);

// Allow filtering by status with either a single value or a CSV list
// (e.g. ?status=new,received). PostgREST .in() will handle the array.
const statusListField = z.preprocess(
  (v) => {
    if (typeof v !== "string" || v.length === 0) return undefined;
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  },
  z.array(taskStatusSchema).min(1).optional(),
);

const limitField = z.preprocess(
  (v) => (typeof v === "string" && v.length > 0 ? Number(v) : v),
  z.number().int().min(1).max(200).default(100),
);

const offsetField = z.preprocess(
  (v) => (typeof v === "string" && v.length > 0 ? Number(v) : v),
  z.number().int().min(0).default(0),
);

const isoDateField = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "Date must be a valid ISO datetime",
  })
  .optional();

export const listTasksQuerySchema = z.object({
  search: searchField,
  status: statusListField,
  priority: taskPrioritySchema.optional(),
  assignedTo: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  // Personal-board filter (Stage 12 Round C): returns the target user's board
  // — (assignee's new/in_progress) OR (creator's done). Overrides status/
  // assignedTo. Viewing another user's board is owner/admin-only (service gate).
  boardFor: z.string().uuid().optional(),
  lifecycle: lifecycleField,
  dueBefore: isoDateField,
  dueAfter: isoDateField,
  limit: limitField,
  offset: offsetField,
});

// ============================================================
// Path params
// ============================================================

export const taskIdParamSchema = z.object({
  id: z.string().uuid("Invalid task id"),
});

// ============================================================
// Inferred types
// ============================================================

export type CreateTaskPayload = z.infer<typeof createTaskSchema>;
export type UpdateTaskPayload = z.infer<typeof updateTaskSchema>;
export type StatusTransitionPayload = z.infer<typeof statusTransitionSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type TaskIdParam = z.infer<typeof taskIdParamSchema>;
