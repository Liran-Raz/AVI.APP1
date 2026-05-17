import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as contactsService from "@/server/services/client-contacts.service";
import {
  contactRouteParamsSchema,
  updateContactSchema,
} from "@/server/validators/client-contacts.schema";

type RouteContext = {
  params: Promise<{ id: string; contactId: string }>;
};

// GET /api/clients/[id]/contacts/[contactId]
export const GET = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const raw = await context.params;
    const { clientId, contactId } = contactRouteParamsSchema.parse({
      clientId: raw.id,
      contactId: raw.contactId,
    });
    const contact = await contactsService.getContact(
      session,
      clientId,
      contactId,
    );
    return ok(contact);
  },
);

// PATCH /api/clients/[id]/contacts/[contactId]
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const raw = await context.params;
    const { clientId, contactId } = contactRouteParamsSchema.parse({
      clientId: raw.id,
      contactId: raw.contactId,
    });
    const body = await request.json().catch(() => ({}));
    const patch = updateContactSchema.parse(body);
    const updated = await contactsService.updateContact(
      session,
      clientId,
      contactId,
      patch,
    );
    return ok(updated);
  },
);

// DELETE /api/clients/[id]/contacts/[contactId]
// Hard delete — contacts don't have a lifecycle. They live or die with
// the client (CASCADE deletes if the client is hard-deleted).
export const DELETE = withErrorHandler(
  async (_request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const raw = await context.params;
    const { clientId, contactId } = contactRouteParamsSchema.parse({
      clientId: raw.id,
      contactId: raw.contactId,
    });
    await contactsService.deleteContact(session, clientId, contactId);
    return ok({ deleted: true });
  },
);
