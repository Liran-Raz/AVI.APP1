import "server-only";
import { createHash, randomBytes } from "node:crypto";

import type { FullSession } from "@/server/auth/session";
import { requirePermission } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import {
  createSupabaseServerClient,
  createSupabasePublicClient,
} from "@/server/db/supabase";
import type {
  Invitation,
  UserRole,
} from "@/server/db/domain.types";
import { env } from "@/server/env";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";
import * as invitationsRepo from "@/server/repositories/invitations.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import type { TeamMemberRow } from "@/server/repositories/team.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import { sendInvitationEmail } from "@/server/services/emails.service";
import { toSafeErrorMeta } from "@/server/email/email-errors";

// ============================================================
// DTOs
// ============================================================

// Member DTO — what the team list shows. Excludes `org_id` (implicit)
// and any audit fields the UI doesn't need.
export type MemberDTO = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
};

// Invitation DTO returned to the inviter immediately after creation.
// Includes `inviteUrl` so admins can copy-paste it when Resend is not
// configured (console fallback). Never includes `token_hash` — the URL
// is the secret material and we only return it once.
export type InvitationDTO = {
  id: string;
  email: string;
  role: UserRole;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  // Present ONLY on the creation response so the inviter can copy the
  // link. Subsequent reads of the invitation never expose it (the raw
  // token is not stored).
  inviteUrl?: string;
  // Whether the invitation email was actually accepted by the provider
  // (true), vs. the send failing (false). The invitation row exists and
  // is usable via `inviteUrl` regardless — but the UI must NOT claim the
  // email was sent when it was not. In dev the console fallback "succeeds"
  // (logs the send), so this is true there too.
  emailDelivered: boolean;
};

// Invitation preview DTO — returned by the public lookup that
// /invite/accept and /invite/signup do to display "you've been invited
// to <org> as <role>". Intentionally minimal.
export type InvitationPreviewDTO = {
  email: string;
  role: UserRole;
  orgName: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
};

// Result of accept — what the client redirects with.
export type AcceptInvitationDTO = {
  orgId: string;
  role: UserRole;
  created: boolean;
};

function memberToDTO(row: TeamMemberRow): MemberDTO {
  return {
    id: row.userId,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.joinedAt,
  };
}

function invitationToDTO(
  row: Invitation,
  inviteUrl: string | undefined,
  emailDelivered: boolean,
): InvitationDTO {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    inviteUrl,
    emailDelivered,
  };
}

// ============================================================
// Authorization
// ============================================================
//
// Coarse capability is enforced via the centralized permission system
// (requirePermission against PERMISSIONS.TEAM_*). The function below is a
// business INVARIANT layered on top of that capability: it constrains WHICH
// target role a manager may assign (anti-escalation). It is intentionally
// role-relational and is retained as an owner/manager invariant per the
// approved Roles & Permissions plan (only Owner may create/assign a Manager).
//
// Admins cannot promote anyone to admin (only owner can elevate to admin).
// They CAN keep members at employee. Owners can set admin or employee.
function assertCanAssignRole(
  session: FullSession,
  targetRole: UserRole,
): void {
  // The validator only allows {admin, employee}, never owner. Defense in
  // depth: re-check here so a bypass at the validator layer still fails.
  if (targetRole === "owner") {
    throw new ForbiddenError("Cannot create or promote to owner");
  }
  // CUTOVER-SAFE: this reads the ENUM role deliberately. It is an enum-bound
  // relational invariant (role hierarchy), NOT a grantable capability, so it is
  // enforced identically whether authorization is code- or DB-authoritative.
  const myRole = session.profile.role;
  if (myRole === "owner") return;
  if (myRole === "admin" && targetRole === "employee") return;
  throw new ForbiddenError("Admins can only invite or assign role 'employee'");
}

// ============================================================
// Token helpers
// ============================================================

function generateRawToken(): string {
  // 32 random bytes → 43-char URL-safe base64 (no padding).
  return randomBytes(32).toString("base64url");
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

const INVITATION_TTL_DAYS = 7;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// ============================================================
// listMembers
// ============================================================

export async function listMembers(
  session: FullSession,
): Promise<{ items: MemberDTO[] }> {
  // Any active member may view the roster (team.view granted to all roles).
  requirePermission(session, PERMISSIONS.TEAM_VIEW);
  // RLS already restricts to the caller's org; the explicit org_id
  // filter in the repo is defense-in-depth. Roster now comes from
  // organization_memberships (joined to profiles for identity).
  const rows = await teamRepo.findMembersByOrgId(session.activeOrg.id);
  return { items: rows.map(memberToDTO) };
}

// ============================================================
// inviteMember
// ============================================================

export type InviteMemberInput = {
  email: string;
  // Narrower than UserRole: the validator already rejects "owner" and
  // the service never invites owners. Keeping the narrower type here
  // lets sendInvitationEmail (which only accepts admin|employee) type-
  // check without a cast.
  role: "admin" | "employee";
};

export async function inviteMember(
  session: FullSession,
  input: InviteMemberInput,
): Promise<InvitationDTO> {
  // Authoritative capability check (owner/admin). The escalation invariant
  // below additionally restricts which role may be assigned.
  requirePermission(session, PERMISSIONS.TEAM_INVITE);
  assertCanAssignRole(session, input.role);

  const orgId = session.activeOrg.id;
  const email = input.email.trim().toLowerCase();

  // Refuse if the email is already a member of this org.
  const existingMember = await teamRepo.findMemberByEmailInOrg(orgId, email);
  if (existingMember) {
    throw new ConflictError(
      existingMember.isActive
        ? "This email is already a member of the organization"
        : "This email is already a member (currently inactive). Reactivate the membership instead.",
    );
  }

  // Refuse if there is already a pending invite for this email in this org.
  // (The DB also has a partial unique index as a safety net.)
  const existingInvite = await invitationsRepo.findPendingByEmailInOrg(
    orgId,
    email,
  );
  if (existingInvite) {
    throw new ConflictError(
      "An invitation is already pending for this email. Wait for it to expire or revoke it first.",
    );
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = isoDaysFromNow(INVITATION_TTL_DAYS);

  const row = await invitationsRepo.create({
    org_id: orgId,
    email,
    role: input.role,
    token_hash: tokenHash,
    expires_at: expiresAt,
    invited_by: session.profile.id,
  });

  const inviteUrl = `${env.NEXT_PUBLIC_SITE_URL}/invite/accept?token=${rawToken}`;

  // Best-effort email send. The invitation row already exists and is
  // usable via `inviteUrl` (the admin can copy it), so a send failure
  // must NOT discard the invitation. But it must be reported truthfully:
  // we surface the outcome via `emailDelivered` instead of swallowing the
  // failure and implying the mail went out.
  let emailDelivered = false;
  try {
    await sendInvitationEmail({
      toEmail: email,
      inviterName: session.profile.full_name,
      orgName: session.organization.name,
      role: input.role,
      inviteUrl,
      expiresAt,
    });
    emailDelivered = true;
  } catch (err) {
    // Log ONLY stable, allowlisted metadata via toSafeErrorMeta — never
    // err.message/stack, the inviteUrl/raw token, or any provider body.
    console.error(
      "[team.service.inviteMember] invitation email send failed",
      toSafeErrorMeta(err),
    );
  }

  return invitationToDTO(row, inviteUrl, emailDelivered);
}

// ============================================================
// changeRole
// ============================================================

export async function changeRole(
  session: FullSession,
  targetUserId: string,
  newRole: UserRole,
): Promise<MemberDTO> {
  // Anti-self-escalation: a member cannot change their own role at all.
  // (Even no-op changes are refused so the rule is simple to audit.)
  if (targetUserId === session.user.id) {
    throw new ForbiddenError("You cannot change your own role");
  }

  // Escalation invariant (rejects non-managers and admin→admin) before any
  // read — preserves the prior contract that a disallowed assignment fails
  // regardless of target existence.
  assertCanAssignRole(session, newRole);

  const orgId = session.activeOrg.id;
  const target = await teamRepo.findMemberInOrg(orgId, targetUserId);
  if (!target) {
    throw new NotFoundError("Member not found in your organization");
  }

  // Authoritative capability check with a SERVER-TRUSTED target context
  // (target role + org loaded via the org-scoped repo above). Cross-org
  // targets never reach here — findMemberInOrg returns null → 404.
  requirePermission(session, PERMISSIONS.TEAM_CHANGE_ROLE, {
    targetUserId,
    targetRole: target.role,
    targetMembershipOrgId: orgId,
  });

  // Anti-owner-demotion: only the owner can change another owner's role,
  // AND we forbid demoting the last owner. CUTOVER-SAFE: this owner-protection
  // reads the ENUM role deliberately (a protected relational invariant) and is
  // enforced regardless of the DB grant map — never grantable via a custom role.
  if (target.role === "owner") {
    if (session.activeRole !== "owner") {
      throw new ForbiddenError("Only an owner can change an owner's role");
    }
    if (newRole !== "owner") {
      // Demoting an owner — make sure another active owner remains.
      const owners = await membershipsRepo.countActiveOwners(orgId);
      if (owners <= 1) {
        throw new ForbiddenError("Cannot demote the last active owner");
      }
    }
  }

  const updated = await membershipsRepo.updateRole(targetUserId, orgId, newRole);
  return memberToDTO({ ...target, role: updated.role });
}

// ============================================================
// deactivateMember
// ============================================================

export async function deactivateMember(
  session: FullSession,
  targetUserId: string,
): Promise<MemberDTO> {
  // Anti-self-deactivation: enforced as a hard rule. Mistake-prevention.
  if (targetUserId === session.user.id) {
    throw new ForbiddenError("You cannot deactivate yourself");
  }

  const orgId = session.activeOrg.id;
  const target = await teamRepo.findMemberInOrg(orgId, targetUserId);
  if (!target) {
    throw new NotFoundError("Member not found in your organization");
  }

  // Authoritative capability check with a SERVER-TRUSTED target context.
  // Cross-org targets never reach here (findMemberInOrg returns null → 404).
  requirePermission(session, PERMISSIONS.TEAM_DEACTIVATE, {
    targetUserId,
    targetRole: target.role,
    targetMembershipOrgId: orgId,
  });

  if (!target.isActive) {
    // Idempotent — already inactive.
    return memberToDTO(target);
  }

  // Owner protection: admins cannot deactivate owners; owners cannot
  // deactivate the last active owner. CUTOVER-SAFE: enum-bound protected
  // invariant, enforced regardless of the DB grant map (never grantable).
  if (target.role === "owner") {
    if (session.activeRole !== "owner") {
      throw new ForbiddenError("Only an owner can deactivate another owner");
    }
    const owners = await membershipsRepo.countActiveOwners(orgId);
    if (owners <= 1) {
      throw new ForbiddenError("Cannot deactivate the last active owner");
    }
  }

  const updated = await membershipsRepo.setActive(targetUserId, orgId, false);
  return memberToDTO({ ...target, isActive: updated.is_active });
}

// ============================================================
// previewInvitation — used by /invite/accept and /invite/signup pages
// to show what the user is accepting before they sign in / sign up.
// Public — does NOT require a session. Looks up by token hash.
// Returns a minimal DTO; never returns invited_by, token_hash, or any
// other admin-side detail.
// ============================================================

export async function previewInvitation(
  rawToken: string,
): Promise<InvitationPreviewDTO> {
  // Read via the SECURITY DEFINER preview_invitation RPC (migration 0010).
  // The invitations table RLS is admin/owner-only, so a direct table read
  // here returns nothing — the invitee is logged-out, or logged-in but not
  // a member of the inviting org. The RPC bypasses RLS and returns ONLY
  // preview-safe fields (email, role, org_name, status, expires_at). It
  // never returns token_hash, org_id, invited_by, accepted_by, or any
  // internal id.
  //
  // Use the cookie-less PUBLIC anon client: this is an anonymous read with no
  // user session. The cookie-bound SSR client's .rpc() fails in this
  // anonymous Server Component context (caused the prior /invite/accept 500);
  // the public client replicates the anon REST path that works.
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("preview_invitation", {
    p_token: rawToken,
  });

  if (error) {
    console.error("[team.service.previewInvitation] RPC failed", {
      code: error.code,
      message: error.message,
    });
    throw new AppError("INTERNAL_ERROR", "Failed to load invitation");
  }

  // The RPC returns SQL NULL (-> null) when no invitation matches the token.
  if (!data || typeof data !== "object" || !("email" in data)) {
    throw new NotFoundError("Invitation not found");
  }

  const row = data as {
    email: string;
    role: UserRole;
    org_name: string;
    status: InvitationPreviewDTO["status"];
    expires_at: string;
  };

  return {
    email: row.email,
    role: row.role,
    // org_name is empty only if the org row vanished; keep the friendly
    // fallback the page showed before.
    orgName: row.org_name || "המשרד שהזמין אותך",
    status: row.status,
    expiresAt: row.expires_at,
  };
}

// ============================================================
// acceptInvitation — thin wrapper around the SECURITY DEFINER RPC.
// The RPC enforces: authenticated, no existing profile, email match,
// status pending, not expired. We log and surface a clean AppError.
// ============================================================

export async function acceptInvitation(
  rawToken: string,
): Promise<AcceptInvitationDTO> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_token: rawToken,
  });

  if (error) {
    const message = error.message?.toLowerCase() ?? "";
    if (message.includes("unauthenticated")) {
      throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
    }
    if (
      message.includes("invalid") ||
      message.includes("expired") ||
      message.includes("required") ||
      message.includes("match")
    ) {
      // 400 — bad/expired/non-matching invitation. Generic message
      // (do not leak which of the conditions failed precisely).
      throw new ValidationError(
        "Invitation is no longer valid. Ask the admin to send a new one.",
      );
    }
    if (message.includes("already a member")) {
      // Multi-office: being a member of OTHER orgs is fine. This only
      // fires when the user is already a member of THIS specific org.
      throw new ConflictError(
        "You are already a member of this organization.",
      );
    }
    console.error("[team.service.acceptInvitation] RPC failed", {
      code: error.code,
      message: error.message,
    });
    throw new AppError("INTERNAL_ERROR", "Failed to accept invitation");
  }

  if (!data || typeof data !== "object" || !("org_id" in data)) {
    throw new AppError("INTERNAL_ERROR", "accept_invitation returned malformed data");
  }

  return {
    orgId: String(data.org_id),
    role: (data as { role: UserRole }).role,
    created: Boolean((data as { created: boolean }).created),
  };
}
