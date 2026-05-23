import "server-only";
import { createHash, randomBytes } from "node:crypto";

import type { FullSession } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/db/supabase";
import type {
  Invitation,
  Profile,
  UserRole,
} from "@/server/db/database.types";
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
import { sendInvitationEmail } from "@/server/services/emails.service";

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

function memberToDTO(row: Profile): MemberDTO {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function invitationToDTO(row: Invitation, inviteUrl?: string): InvitationDTO {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    inviteUrl,
  };
}

// ============================================================
// Authorization helpers
// ============================================================

function assertCanInvite(session: FullSession): void {
  const role = session.profile.role;
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenError("Only owner or admin can invite members");
  }
}

function assertCanManageTeam(session: FullSession): void {
  const role = session.profile.role;
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenError("Only owner or admin can manage team members");
  }
}

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
  // RLS already restricts to the caller's org; the explicit org_id
  // filter in the repo is defense-in-depth.
  const rows = await teamRepo.findMembersByOrgId(session.organization.id);
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
  assertCanInvite(session);
  assertCanAssignRole(session, input.role);

  const orgId = session.organization.id;
  const email = input.email.trim().toLowerCase();

  // Refuse if the email is already an active member of this org.
  const existingMember = await teamRepo.findByEmailInOrg(orgId, email);
  if (existingMember) {
    throw new ConflictError(
      existingMember.is_active
        ? "This email is already a member of the organization"
        : "This email is already a member (currently inactive). Reactivate the profile instead.",
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

  // Best-effort email send. If the email adapter throws, we still
  // return success so the inviter can copy the URL — they may even be
  // running the console adapter on purpose. Errors are logged.
  try {
    await sendInvitationEmail({
      toEmail: email,
      inviterName: session.profile.full_name,
      orgName: session.organization.name,
      role: input.role,
      inviteUrl,
      expiresAt,
    });
  } catch (err) {
    console.error("[team.service.inviteMember] email send failed:", err);
  }

  return invitationToDTO(row, inviteUrl);
}

// ============================================================
// changeRole
// ============================================================

export async function changeRole(
  session: FullSession,
  targetProfileId: string,
  newRole: UserRole,
): Promise<MemberDTO> {
  assertCanManageTeam(session);
  assertCanAssignRole(session, newRole);

  // Anti-self-escalation: a member cannot change their own role at all.
  // (Even no-op changes are refused so the rule is simple to audit.)
  if (targetProfileId === session.profile.id) {
    throw new ForbiddenError("You cannot change your own role");
  }

  const target = await teamRepo.findById(targetProfileId);
  if (!target || target.org_id !== session.organization.id) {
    throw new NotFoundError("Member not found in your organization");
  }

  // Anti-owner-demotion: only the owner can change another owner's role,
  // AND we forbid demoting the last owner.
  if (target.role === "owner") {
    if (session.profile.role !== "owner") {
      throw new ForbiddenError("Only an owner can change an owner's role");
    }
    if (newRole !== "owner") {
      // Demoting an owner — make sure another active owner remains.
      const owners = await teamRepo.countActiveOwners(session.organization.id);
      if (owners <= 1) {
        throw new ForbiddenError("Cannot demote the last active owner");
      }
    }
  }

  const updated = await teamRepo.updateRole(
    targetProfileId,
    session.organization.id,
    newRole,
  );
  return memberToDTO(updated);
}

// ============================================================
// deactivateMember
// ============================================================

export async function deactivateMember(
  session: FullSession,
  targetProfileId: string,
): Promise<MemberDTO> {
  assertCanManageTeam(session);

  // Anti-self-deactivation: enforced as a hard rule. Mistake-prevention.
  if (targetProfileId === session.profile.id) {
    throw new ForbiddenError("You cannot deactivate yourself");
  }

  const target = await teamRepo.findById(targetProfileId);
  if (!target || target.org_id !== session.organization.id) {
    throw new NotFoundError("Member not found in your organization");
  }

  if (!target.is_active) {
    // Idempotent — already inactive.
    return memberToDTO(target);
  }

  // Owner protection: admins cannot deactivate owners; owners cannot
  // deactivate the last active owner.
  if (target.role === "owner") {
    if (session.profile.role !== "owner") {
      throw new ForbiddenError("Only an owner can deactivate another owner");
    }
    const owners = await teamRepo.countActiveOwners(session.organization.id);
    if (owners <= 1) {
      throw new ForbiddenError("Cannot deactivate the last active owner");
    }
  }

  const updated = await teamRepo.setActive(
    targetProfileId,
    session.organization.id,
    false,
  );
  return memberToDTO(updated);
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
  const tokenHash = hashToken(rawToken);
  const inv = await invitationsRepo.findByTokenHash(tokenHash);
  if (!inv) {
    throw new NotFoundError("Invitation not found");
  }
  // Look up org name with a direct query (avoids creating a whole repo
  // method just for one read). RLS would normally block anon, but the
  // /invite/accept page runs as a server component without a user
  // session yet — so the lookup goes through anon. To keep this
  // working without expanding anon's RLS scope, we use the Supabase
  // server client which uses the anon key and just attempt the read;
  // org names are not secret. If it returns null we degrade gracefully.
  const supabase = await createSupabaseServerClient();
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", inv.org_id)
    .maybeSingle();
  return {
    email: inv.email,
    role: inv.role,
    orgName: (orgRow as { name?: string } | null)?.name ?? "המשרד שהזמין אותך",
    status: inv.status,
    expiresAt: inv.expires_at,
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
      throw new ConflictError(
        "You are already a member of an organization. Sign out first if you want to accept this invitation under a different account.",
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
