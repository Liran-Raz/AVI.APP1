import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as tasksService from "@/server/services/tasks.service";
import { taskIdParamSchema } from "@/server/validators/tasks.schema";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/tasks/[id]/unarchive
// Clears archived_at — task returns to the active queue.
// Returns: { success: true, data: TaskDTO }
export const POST = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = taskIdParamSchema.parse(await context.params);
    const updated = await tasksService.unarchiveTask(session, id);
    return ok(updated);
  },
);
