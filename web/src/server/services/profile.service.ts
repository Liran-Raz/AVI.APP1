import "server-only";

import type { FullSession } from "@/server/auth/session";
import type { UserRole } from "@/server/db/domain.types";
import { AppError } from "@/server/errors/app-error";
import * as profileRepo from "@/server/repositories/profile.repository";
import type { UpdateProfilePayload } from "@/server/validators/profile.schema";

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
