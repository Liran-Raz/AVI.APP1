import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as ledgersService from "@/server/services/ledgers.service";
import {
  ledgerIdParamSchema,
  updateLedgerSchema,
} from "@/server/validators/ledgers.schema";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/ledgers/[id]
// Body: UpdateLedgerPayload (business profile — legal identity fields)
// Returns: { success: true, data: LedgerDTO }
// Gated in the service by ledgers.manage (owner-only).
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: RouteContext) => {
    const session = await requireSession();
    const { id } = ledgerIdParamSchema.parse(await context.params);
    const body = await request.json().catch(() => ({}));
    const input = updateLedgerSchema.parse(body);
    const updated = await ledgersService.updateLedger(session, id, input);
    return ok(updated);
  },
);
