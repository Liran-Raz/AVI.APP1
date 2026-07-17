import "server-only";

import type { FullSession } from "@/server/auth/session";
import { AppError, ForbiddenError } from "@/server/errors/app-error";
import * as organizationRepo from "@/server/repositories/organization.repository";
import type { UpdateOrganizationPayload } from "@/server/validators/organization.schema";

// Office details DTO for the settings screen. `orgCode` is display/copy only —
// it is never editable through the update path.
export type OrganizationDTO = {
  id: string;
  name: string;
  orgCode: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  // DEV-013: office-wide 2FA requirement (owner-controlled).
  requireMfa: boolean;
};

// Update the ACTIVE office's details. Owner-only (trust boundary); the DB RLS
// policy "owner can update own org" enforces the same rule independently.
export async function updateOrganization(
  session: FullSession,
  input: UpdateOrganizationPayload,
): Promise<OrganizationDTO> {
  if (session.activeRole !== "owner") {
    throw new ForbiddenError("Only the office owner can edit office details");
  }

  const patch: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    require_mfa?: boolean;
  } = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.address !== undefined) patch.address = input.address;
  if (input.requireMfa !== undefined) patch.require_mfa = input.requireMfa;

  const updated = await organizationRepo.update(session.activeOrg.id, patch);
  if (!updated) {
    // Owner already asserted above, so a null means RLS unexpectedly
    // rejected the write.
    throw new AppError("INTERNAL_ERROR", "Could not update office");
  }

  return {
    id: updated.id,
    name: updated.name,
    orgCode: updated.org_code,
    email: updated.email,
    phone: updated.phone,
    address: updated.address,
    // Defensive read: the column exists only after migration 0028 is
    // applied (same pattern as memberships.dashboard_access).
    requireMfa: updated.require_mfa === true,
  };
}
