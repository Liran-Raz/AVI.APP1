import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as clientsService from "@/server/services/clients.service";
import {
  clientIdParamSchema,
  updateClientSchema,
} from "@/server/validators/clients.schema";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/clients/[id]
// Returns: { success: true, data: ClientDTO }
export const GET = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = clientIdParamSchema.parse(await context.params);
    const client = await clientsService.getClient(session, id);
    return ok(client);
  },
);

// PATCH /api/clients/[id]
// Body: UpdateClientPayload (at least one field)
// Returns: { success: true, data: ClientDTO }
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = clientIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const patch = updateClientSchema.parse(body);
    const updated = await clientsService.updateClient(session, id, patch);
    return ok(updated);
  },
);
