import { notFound, redirect } from "next/navigation";

import { getCurrentSession, type FullSession } from "@/server/auth/session";
import { can } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import {
  isRoleManagementUiEnabled,
  isRoleManagementWriteEnabled,
} from "@/server/auth/role-management.flags";
import * as rolesService from "@/server/services/roles.service";
import { RolesPage } from "@/components/roles/roles-page";

// Role management. Hidden entirely unless the ROLES_MANAGEMENT_UI flag is on AND
// the viewer can view roles (Owner/Manager). Writes additionally require the
// ROLES_MANAGEMENT_WRITE flag + roles.manage (Owner) — re-checked in the service
// and the DB RPCs.
export default async function RolesRoute() {
  if (!isRoleManagementUiEnabled()) notFound();

  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.activeOrg || !session.activeRole) {
    redirect("/onboarding");
  }
  const full = session as FullSession;
  if (!can(full, PERMISSIONS.ROLES_VIEW)) notFound();

  const initial = await rolesService.listRoles(full);
  const canWrite =
    isRoleManagementWriteEnabled() && can(full, PERMISSIONS.ROLES_MANAGE);

  return <RolesPage initialRoles={initial.items} canWrite={canWrite} />;
}
