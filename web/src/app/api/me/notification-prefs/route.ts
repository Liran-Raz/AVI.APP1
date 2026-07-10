import "server-only";
import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import { ok, withErrorHandler } from "@/server/errors/api-handler";
import * as profileService from "@/server/services/profile.service";
import { updateNotificationPrefsSchema } from "@/server/validators/profile.schema";

// GET /api/me/notification-prefs — the caller's resolved notification prefs.
export const GET = withErrorHandler(async () => {
  const session = await requireSession();
  return ok(profileService.getNotificationPrefs(session.profile));
});

// PATCH /api/me/notification-prefs — merge a partial update over the stored
// prefs. Body: { emailOnTaskAssignment? }. Returns the resolved prefs.
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const session = await requireSession();
  const body = await request.json().catch(() => ({}));
  const input = updateNotificationPrefsSchema.parse(body);
  const prefs = await profileService.updateMyNotificationPrefs(session, input);
  return ok(prefs);
});
