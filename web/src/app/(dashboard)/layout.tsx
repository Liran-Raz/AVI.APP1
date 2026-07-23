import { redirect } from "next/navigation";

import { AppShell } from "@/components/dashboard/app-shell";
import { MfaEnforcementGate } from "@/components/mfa/mfa-enforcement-gate";
import { getCurrentSession, type FullSession } from "@/server/auth/session";
import { can } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import { isRoleManagementUiEnabled } from "@/server/auth/role-management.flags";
import { isInvoicingUiEnabled } from "@/server/auth/invoicing.flags";
import { isStorageUiEnabled } from "@/server/auth/storage.flags";
import { canViewDashboard } from "@/server/services/dashboard.service";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.mfaPending) {
    // DEV-013: enrolled user, aal1 session (e.g. straight from Google
    // OAuth) — complete the TOTP challenge first. Checked before the
    // onboarding branch so a pending user can't reach any app surface.
    redirect("/mfa");
  }
  if (!session.profile || !session.activeOrg) {
    // Authed but no active office (no profile yet, or deactivated
    // everywhere) — finish / create org setup first.
    redirect("/onboarding");
  }

  const offices = session.memberships.map((m) => ({
    orgId: m.orgId,
    name: m.orgName,
    role: m.role,
  }));

  // Reveal the roles-management nav only when the UI flag is on AND the viewer
  // can view roles (Owner/Manager). Display-only — the page + RPCs re-check.
  const showRolesNav =
    isRoleManagementUiEnabled() &&
    can(session as FullSession, PERMISSIONS.ROLES_VIEW);

  // Reveal the management dashboard nav — owner, or a member the owner granted
  // access to (Stage 13 R4). Display-only; the /dashboard page + dashboard.service
  // re-check with the same rule.
  const showDashboardNav = canViewDashboard(session as FullSession);

  // Reveal the invoicing nav (DEV-026) only when the INVOICING_UI flag is on AND
  // the viewer can view invoices. Display-only — pages + services re-check.
  const showInvoicingNav =
    isInvoicingUiEnabled() &&
    can(session as FullSession, PERMISSIONS.INVOICES_VIEW);

  // Reveal the reports nav (DEV-026 R4) — same flag, reports.view capability
  // (owner/manager; employees have no reports grant). Display-only.
  const showReportsNav =
    isInvoicingUiEnabled() &&
    can(session as FullSession, PERMISSIONS.REPORTS_VIEW);

  // Reveal the storage nav (DEV-032) — STORAGE_UI flag + attachments.view.
  // Display-only; the /storage page + services re-check.
  const showStorageNav =
    isStorageUiEnabled() &&
    can(session as FullSession, PERMISSIONS.ATTACHMENTS_VIEW);

  // DEV-013: the office requires 2FA but this member hasn't set it up →
  // HARD gate (Settings is the only reachable page until they enroll).
  // Defensive read: the require_mfa column lands with migration 0028.
  const mfaSetupRequired =
    session.activeOrg.require_mfa === true && !session.user.hasVerifiedTotp;

  return (
    <AppShell
      profile={session.profile}
      organization={session.activeOrg}
      memberships={offices}
      activeOrgId={session.activeOrg.id}
      showRolesNav={showRolesNav}
      showDashboardNav={showDashboardNav}
      showInvoicingNav={showInvoicingNav}
      showReportsNav={showReportsNav}
      showStorageNav={showStorageNav}
    >
      <MfaEnforcementGate required={mfaSetupRequired}>
        {children}
      </MfaEnforcementGate>
    </AppShell>
  );
}
