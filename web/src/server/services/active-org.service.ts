import "server-only";

import type { FullSession } from "@/server/auth/session";
import { writeActiveOrgCookie } from "@/server/auth/active-org-cookie";
import { ForbiddenError } from "@/server/errors/app-error";
import * as membershipsRepo from "@/server/repositories/memberships.repository";

export type SetActiveOrgResult = {
  activeOrgId: string;
};

// Switch the caller's active office.
//
// SECURITY: the cookie is never trusted on its own. We validate against
// the DB that the caller has an ACTIVE membership in the target org
// before writing the cookie. A non-member / inactive-member request is
// rejected with 403 and the cookie is left untouched. RLS is the second
// line of defense even if this check were bypassed.
export async function setActiveOrg(
  session: FullSession,
  orgId: string,
): Promise<SetActiveOrgResult> {
  const membership = await membershipsRepo.findByUserAndOrg(
    session.user.id,
    orgId,
  );
  if (!membership || !membership.is_active) {
    throw new ForbiddenError(
      "You are not an active member of that organization",
    );
  }

  await writeActiveOrgCookie(orgId);
  return { activeOrgId: orgId };
}
