import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as conversationsService from "@/server/services/conversations.service";
import { createGroupSchema } from "@/server/validators/conversations.schema";

// GET /api/conversations
//   The caller's GROUP conversations (office + DMs are derived client-side from the
//   roster, as in R1). 200 { items: GroupSummaryDTO[] } · 401 not signed in.
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  return ok(await conversationsService.listMyGroups(session));
});

// POST /api/conversations   Body: { title: string, memberIds: string[] }
//   Creates a group; the creator becomes its admin. Non-member / self ids in
//   memberIds are ignored server-side. 200 GroupSummaryDTO · 400 invalid · 401.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const raw = await request.json().catch(() => ({}));
  const input = createGroupSchema.parse(raw);
  return ok(await conversationsService.createGroup(session, input));
});
