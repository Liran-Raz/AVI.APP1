import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as tasksService from "@/server/services/tasks.service";
import {
  createTaskSchema,
  listTasksQuerySchema,
} from "@/server/validators/tasks.schema";

// GET /api/tasks
//   ?search=&status=&priority=&assignedTo=&clientId=&lifecycle=&dueBefore=&dueAfter=&limit=&offset=
// Returns: { success: true, data: { items: TaskDTO[] } }
export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const query = listTasksQuerySchema.parse(params);
  const result = await tasksService.listTasks(session, query);
  return ok(result);
});

// POST /api/tasks
// Body: CreateTaskPayload
// Returns 201 with: { success: true, data: TaskDTO }
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = createTaskSchema.parse(body);
  const created = await tasksService.createTask(session, input);
  return ok(created, { status: 201 });
});
