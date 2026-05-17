import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as tasksService from "@/server/services/tasks.service";
import {
  statusTransitionSchema,
  taskIdParamSchema,
} from "@/server/validators/tasks.schema";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/tasks/[id]/status
// Body: { status: 'new' | 'received' | 'in_progress' | 'done' }
// Returns: { success: true, data: TaskDTO }
//
// The DB trigger tasks_set_completed_at automatically manages
// completed_at when status crosses the done boundary.
export const POST = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = taskIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const { status } = statusTransitionSchema.parse(body);
    const updated = await tasksService.transitionStatus(session, id, status);
    return ok(updated);
  },
);
