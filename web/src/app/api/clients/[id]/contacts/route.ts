import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as contactsService from "@/server/services/client-contacts.service";
import {
  contactClientOnlyParamsSchema,
  createContactSchema,
} from "@/server/validators/client-contacts.schema";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/clients/[id]/contacts
// Returns: { success: true, data: { items: ContactDTO[] } }
export const GET = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = await context.params;
    const { clientId } = contactClientOnlyParamsSchema.parse({ clientId: id });
    const result = await contactsService.listContacts(session, clientId);
    return ok(result);
  },
);

// POST /api/clients/[id]/contacts
// Body: CreateContactPayload
// Returns 201 with: { success: true, data: ContactDTO }
export const POST = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = await context.params;
    const { clientId } = contactClientOnlyParamsSchema.parse({ clientId: id });
    const body = await request.json().catch(() => ({}));
    const input = createContactSchema.parse(body);
    const created = await contactsService.createContact(
      session,
      clientId,
      input,
    );
    return ok(created, { status: 201 });
  },
);
