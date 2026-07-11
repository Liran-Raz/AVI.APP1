import "server-only";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as healthService from "@/server/services/health.service";

// GET /api/health/db
//
// Authenticated DB-connectivity probe for the topbar indicator.
// Deliberately separate from the public /api/health, which does NOT
// touch the database (anonymous RLS reads false-negative — see the
// note there). Running as an authenticated member makes a tiny RLS
// read of the caller's own org a truthful reachability signal.
//   200 { db: "ok" } = DB reachable
//   503              = provider error / org row not visible
//   401              = not signed in (the client treats this as
//                      neutral — an expired session is not a DB fault)
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  return ok(await healthService.checkDbHealth(session));
});
