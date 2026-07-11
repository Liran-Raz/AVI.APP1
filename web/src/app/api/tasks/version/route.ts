import "server-only";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as tasksService from "@/server/services/tasks.service";

// GET /api/tasks/version
//
// Cheap change-signal for live board polling (Stage 13 R6). Returns a small
// opaque version string for the caller's org; the client polls this every few
// seconds and refetches the board only when it changes — so frequent polling
// stays near-free (no task rows are returned here).
//   200 { version: "<count>:<maxUpdatedAt>" }
//   401 not signed in
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  return ok(await tasksService.getBoardVersion(session));
});
