import "server-only";

import { ok, withErrorHandler } from "@/server/errors/api-handler";
// Importing env triggers the zod validator at module load — if env is
// missing/invalid, server boot fails. Reaching this handler at all
// means env is well-formed.
import "@/server/env";

// GET /api/health
//
// Lightweight liveness probe. Returns 200 with a small JSON envelope
// so load balancers / uptime monitors can verify the app is serving
// requests and env validation passed.
//
// We deliberately do NOT query the database here:
//   - Anonymous DB queries hit RLS and would report tables as
//     "missing" even when they exist — a false-positive that misled
//     us during the GRANTs incident.
//   - Adding a DB ping would either require a SECURITY DEFINER ping()
//     function (extra migration) or expose internal schema/permissions.
// For now, the route reports app/env health only. A separate readiness
// probe with DB connectivity can be added later if needed.
export const GET = withErrorHandler(async () => {
  return ok({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});
