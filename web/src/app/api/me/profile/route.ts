import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as profileService from "@/server/services/profile.service";
import { updateProfileSchema } from "@/server/validators/profile.schema";

// PATCH /api/me/profile
// Body: { fullName?, phone? }  — update the caller's OWN profile.
// Returns: { success: true, data: MyProfileDTO }
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = updateProfileSchema.parse(body);
  const profile = await profileService.updateMyProfile(session, input);
  return ok(profile);
});
