import "server-only";

import type { FullSession } from "@/server/auth/session";
import { AppError } from "@/server/errors/app-error";
import * as healthRepo from "@/server/repositories/health.repository";

// Health service — backs the authenticated DB-connectivity probe
// (topbar indicator). The public /api/health stays DB-free by design
// (anonymous RLS reads false-negative — see the note in that route);
// this probe runs as an authenticated member, so an RLS read of the
// caller's own active org is a truthful reachability signal: a thrown
// provider error or a missing row both mean "not healthy".

export type DbHealthDTO = { db: "ok" };

export async function checkDbHealth(
  session: FullSession,
): Promise<DbHealthDTO> {
  let reachable: boolean;
  try {
    reachable = await healthRepo.pingDb(session.organization.id);
  } catch (err) {
    // PII-free operational log; the outward error stays generic.
    console.error("[health.service] db ping failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    throw new AppError("INTERNAL_ERROR", "Database unreachable", 503);
  }
  if (!reachable) {
    throw new AppError("INTERNAL_ERROR", "Database unreachable", 503);
  }
  return { db: "ok" };
}
