import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as clientsService from "@/server/services/clients.service";
import { clientIdParamSchema } from "@/server/validators/clients.schema";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/clients/[id]/restore
// Permission: owner or admin only (enforced in service).
// Returns: { success: true, data: ClientDTO } (is_active === true)
export const POST = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = clientIdParamSchema.parse(await context.params);
    const updated = await clientsService.restoreClient(session, id);
    return ok(updated);
  },
);
