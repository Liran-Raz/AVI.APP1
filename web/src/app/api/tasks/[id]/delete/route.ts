import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as tasksService from "@/server/services/tasks.service";
import { taskIdParamSchema } from "@/server/validators/tasks.schema";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/tasks/[id]/delete
// Soft-delete: sets deleted_at to now(). Task moves to the recycle bin.
// Restorable via /restore. Not auto-purged.
// Returns: { success: true, data: TaskDTO }
export const POST = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = taskIdParamSchema.parse(await context.params);
    const updated = await tasksService.deleteTask(session, id);
    return ok(updated);
  },
);
