import "server-only";

import type { FullSession } from "@/server/auth/session";
import type { Profile, UserRole } from "@/server/db/domain.types";
import { AppError } from "@/server/errors/app-error";
import * as profileRepo from "@/server/repositories/profile.repository";
import type {
  UpdateNotificationPrefsPayload,
  UpdateProfilePayload,
} from "@/server/validators/profile.schema";

// Display DTO for the settings screen — only the safe self-profile fields.
// `role` reflects the ACTIVE office (from the session), not the legacy
// persisted profiles.role column.
export type MyProfileDTO = {
  fullName: string;
  email: string;
  phone: string | null;
  role: UserRole;
};

// Update the caller's OWN name / phone. Whitelist enforced here: a user may
// never change their role / org_id / is_active / email through this path —
// only `full_name` and `phone` are forwarded to the repository.
export async function updateMyProfile(
  session: FullSession,
  input: UpdateProfilePayload,
): Promise<MyProfileDTO> {
  const patch: { full_name?: string; phone?: string | null } = {};
  if (input.fullName !== undefined) patch.full_name = input.fullName;
  if (input.phone !== undefined) patch.phone = input.phone;

  const updated = await profileRepo.updateOwnProfile(session.user.id, patch);
  if (!updated) {
    // A valid session should always be able to self-update; a null here
    // means RLS unexpectedly rejected the write.
    throw new AppError("INTERNAL_ERROR", "Could not update profile");
  }

  return {
    fullName: updated.full_name,
    email: updated.email,
    phone: updated.phone,
    role: session.activeRole,
  };
}

// ============================================================
// Notification preferences (Settings → התראות)
// ============================================================
//
// Stored in profiles.notification_prefs (jsonb, migration 0019). The stored
// value may be partial or empty ({}) — the reader always returns a fully
// resolved object with every key defaulted, so callers never branch on
// "absent". Absent/unknown => the safe default (notifications ON).

export type NotificationPrefs = {
  // Email the assignee when a task is assigned to them.
  emailOnTaskAssignment: boolean;
};

export const NOTIFICATION_PREFS_DEFAULTS: NotificationPrefs = {
  emailOnTaskAssignment: true,
};

// Resolve a raw jsonb value (possibly null / partial / from before the
// migration) into a complete, typed prefs object. Tolerant by design.
export function readNotificationPrefs(raw: unknown): NotificationPrefs {
  const stored =
    raw && typeof raw === "object" ? (raw as Partial<NotificationPrefs>) : {};
  return {
    emailOnTaskAssignment:
      typeof stored.emailOnTaskAssignment === "boolean"
        ? stored.emailOnTaskAssignment
        : NOTIFICATION_PREFS_DEFAULTS.emailOnTaskAssignment,
  };
}

// Read the caller's current prefs from their session profile (already loaded).
export function getNotificationPrefs(profile: Profile): NotificationPrefs {
  return readNotificationPrefs(profile.notification_prefs);
}

// Merge a partial update over the current prefs and persist. Writes only the
// notification_prefs column (via the same self-update RLS path).
export async function updateMyNotificationPrefs(
  session: FullSession,
  input: UpdateNotificationPrefsPayload,
): Promise<NotificationPrefs> {
  const current = readNotificationPrefs(session.profile.notification_prefs);
  const merged: NotificationPrefs = { ...current, ...input };

  const updated = await profileRepo.updateOwnProfile(session.user.id, {
    notification_prefs: merged,
  });
  if (!updated) {
    throw new AppError("INTERNAL_ERROR", "Could not update notification preferences");
  }
  return readNotificationPrefs(updated.notification_prefs);
}
