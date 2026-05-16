import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as clientsService from "@/server/services/clients.service";
import {
  createClientSchema,
  listClientsQuerySchema,
} from "@/server/validators/clients.schema";

// GET /api/clients
//   ?search=&businessType=&status=active|archived|all&limit=&offset=
// Returns: { success: true, data: { items: ClientDTO[] } }
export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const query = listClientsQuerySchema.parse(params);
  const result = await clientsService.listClients(session, query);
  return ok(result);
});

// POST /api/clients
// Body: CreateClientPayload
// Returns 201 with: { success: true, data: ClientDTO }
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = createClientSchema.parse(body);
  const created = await clientsService.createClient(session, input);
  return ok(created, { status: 201 });
});
