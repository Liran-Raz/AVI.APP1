import "server-only";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as ledgersService from "@/server/services/ledgers.service";

// GET /api/ledgers
// Returns: { success: true, data: { items: LedgerDTO[] } }
// Stage A: a single self-ledger per org (the office itself). Stage B will add
// client-owned ledgers to the same list, so the shape is already plural.
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  const items = await ledgersService.listLedgers(session);
  return ok({ items });
});
