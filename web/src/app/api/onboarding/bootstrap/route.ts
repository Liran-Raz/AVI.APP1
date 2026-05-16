import "server-only";
import type { NextRequest } from "next/server";

import { requireUser } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as onboardingService from "@/server/services/onboarding.service";
import { bootstrapOrgSchema } from "@/server/validators/onboarding.schema";

// POST /api/onboarding/bootstrap
// Body: { orgName, orgCode, fullName }
// Auth: required (an existing auth.user must call this)
// Returns: { success: true, data: { orgId, created } }
//
// Side effects (handled by the SECURITY DEFINER RPC):
//   - creates a row in organizations
//   - creates an owner profile linked to the caller's auth.uid()
//
// Idempotent: if the caller already has a profile, returns the
// existing org_id with `created: false`.
export const POST = withErrorHandler(async (request: NextRequest) => {
  // 401 if no session
  await requireUser();

  const body = await request.json().catch(() => ({}));
  const input = bootstrapOrgSchema.parse(body);
  const result = await onboardingService.bootstrapOrg(input);
  return ok(result);
});
