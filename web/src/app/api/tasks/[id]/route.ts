import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as tasksService from "@/server/services/tasks.service";
import {
  taskIdParamSchema,
  updateTaskSchema,
} from "@/server/validators/tasks.schema";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/tasks/[id]
// Returns: { success: true, data: TaskDTO }
export const GET = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = taskIdParamSchema.parse(await context.params);
    const task = await tasksService.getTask(session, id);
    return ok(task);
  },
);

// PATCH /api/tasks/[id]
// Body: UpdateTaskPayload (at least one field)
// Returns: { success: true, data: TaskDTO }
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = taskIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const patch = updateTaskSchema.parse(body);
    const updated = await tasksService.updateTask(session, id, patch);
    return ok(updated);
  },
);
