import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmailDeliveryError } from "@/server/email/email-errors";
import type { FullSession } from "@/server/auth/session";
import type { Invitation, OrganizationMembership } from "@/server/db/domain.types";
import type { UserRole } from "@/server/db/domain.types";

// Mock all of team.service's heavy dependencies so importing it does not
// boot env validation or the Supabase client, and so we can drive the
// invitation-email outcome deterministically.
vi.mock("@/server/env", () => ({
  env: { NEXT_PUBLIC_SITE_URL: "https://app.example.test" },
}));
vi.mock("@/server/db/supabase", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabasePublicClient: vi.fn(),
}));
vi.mock("@/server/repositories/team.repository", () => ({
  findMembersByOrgId: vi.fn(),
  findMemberByEmailInOrg: vi.fn(),
  findMemberInOrg: vi.fn(),
}));
vi.mock("@/server/repositories/invitations.repository", () => ({
  findPendingByEmailInOrg: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/server/repositories/memberships.repository", () => ({
  countActiveOwners: vi.fn(),
  updateRole: vi.fn(),
  setActive: vi.fn(),
  setDashboardAccess: vi.fn(),
}));
vi.mock("@/server/services/emails.service", () => ({
  sendInvitationEmail: vi.fn(),
}));

import * as invitationsRepo from "@/server/repositories/invitations.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import type { TeamMemberRow } from "@/server/repositories/team.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import { sendInvitationEmail } from "@/server/services/emails.service";
import {
  changeRole,
  deactivateMember,
  inviteMember,
  listMembers,
  setDashboardAccess,
} from "@/server/services/team.service";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";

const session = {
  user: { id: "owner-user" },
  profile: { id: "owner-profile", role: "owner", full_name: "Owner One" },
  activeOrg: { id: "org-1" },
  activeRole: "owner",
  organization: { id: "org-1", name: "Test Org" },
} as unknown as FullSession;

const fakeRow = {
  id: "inv-1",
  org_id: "org-1",
  email: "new@example.test",
  role: "employee",
  token_hash: "hash",
  status: "pending",
  expires_at: "2026-07-01T00:00:00.000Z",
  created_at: "2026-06-19T00:00:00.000Z",
  invited_by: "owner-profile",
  accepted_by: null,
  accepted_at: null,
} as unknown as Invitation;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(teamRepo.findMemberByEmailInOrg).mockResolvedValue(null);
  vi.mocked(invitationsRepo.findPendingByEmailInOrg).mockResolvedValue(null);
  vi.mocked(invitationsRepo.create).mockResolvedValue(fakeRow);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("inviteMember — email delivery is reported truthfully", () => {
  it("emailDelivered=true when the invitation email send succeeds", async () => {
    vi.mocked(sendInvitationEmail).mockResolvedValue(undefined);

    const dto = await inviteMember(session, {
      email: "New@Example.test",
      role: "employee",
    });

    expect(dto.emailDelivered).toBe(true);
    expect(dto.inviteUrl).toContain("/invite/accept?token=");
  });

  it("emailDelivered=false when the send throws — no false success, invitation still usable", async () => {
    vi.mocked(sendInvitationEmail).mockRejectedValue(
      new Error("Resend send failed: 401 Unauthorized"),
    );

    const dto = await inviteMember(session, {
      email: "New@Example.test",
      role: "employee",
    });

    // Best-effort: the invitation row still exists ...
    expect(dto.id).toBe("inv-1");
    // ... the URL is still returned so the admin can retry by copying it ...
    expect(dto.inviteUrl).toContain("/invite/accept?token=");
    // ... but the result must NOT claim the email was sent.
    expect(dto.emailDelivered).toBe(false);
  });

  it("logs only safe metadata — a malicious plain Error leaks nothing", async () => {
    const recipientEmail = "victim@secret.example.com";
    const apiKeyLike = "re_LEAK_SECRET_abc123";
    const providerBody = "<html>secret provider body</html>";
    // A plain Error whose message is stuffed with sensitive strings.
    const leaky = new Error(
      `to ${recipientEmail} apikey=${apiKeyLike} body=${providerBody} token=PLACEHOLDER`,
    );
    vi.mocked(sendInvitationEmail).mockRejectedValue(leaky);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const dto = await inviteMember(session, {
      email: recipientEmail,
      role: "employee",
    });
    const rawToken = (dto.inviteUrl ?? "").split("token=")[1] ?? "";
    expect(rawToken.length).toBeGreaterThan(10);

    // The logged metadata is category-only for an unknown error.
    const [, meta] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta).toEqual({ category: "unknown_error" });

    // None of the sensitive strings appear anywhere in the log call.
    const logged = errorSpy.mock.calls
      .map((c: unknown[]) => JSON.stringify(c))
      .join(" ");
    expect(logged).not.toContain(recipientEmail);
    expect(logged).not.toContain(apiKeyLike);
    expect(logged).not.toContain(providerBody);
    expect(logged).not.toContain(rawToken);
  });

  it("a real EmailDeliveryError logs only approved stable metadata", async () => {
    vi.mocked(sendInvitationEmail).mockRejectedValue(
      new EmailDeliveryError({
        provider: "resend",
        status: 502,
        code: "application_error",
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await inviteMember(session, { email: "x@example.test", role: "employee" });

    const [, meta] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta).toEqual({
      category: "delivery_error",
      provider: "resend",
      status: 502,
      providerCode: "application_error",
    });
  });
});

// ============================================================
// Phase 2 — Team & Invitations authorization (permission-wired)
// ============================================================

function makeSession(
  role: UserRole,
  opts: { userId?: string } = {},
): FullSession {
  const userId = opts.userId ?? `${role}-user`;
  return {
    user: { id: userId },
    profile: { id: userId, role, full_name: `${role} U`, email: `${role}@x.test` },
    activeOrg: { id: "org-1" },
    activeRole: role,
    organization: { id: "org-1", name: "Test Org" },
  } as unknown as FullSession;
}

function memberRow(o: {
  userId: string;
  role: UserRole;
  isActive?: boolean;
  dashboardAccess?: boolean;
}): TeamMemberRow {
  return {
    userId: o.userId,
    fullName: "Target U",
    email: "target@x.test",
    role: o.role,
    isActive: o.isActive ?? true,
    joinedAt: "2026-01-01T00:00:00.000Z",
    dashboardAccess: o.dashboardAccess ?? false,
  };
}

const ownerS = makeSession("owner", { userId: "owner-user" });
const adminS = makeSession("admin", { userId: "admin-user" });
const employeeS = makeSession("employee", { userId: "employee-user" });

describe("listMembers — any active member may view the roster", () => {
  beforeEach(() => {
    vi.mocked(teamRepo.findMembersByOrgId).mockResolvedValue([]);
  });
  it.each(["owner", "admin", "employee"] as const)("allows %s", async (role) => {
    await expect(listMembers(makeSession(role))).resolves.toEqual({ items: [] });
  });
});

describe("inviteMember — capability + escalation invariant", () => {
  beforeEach(() => {
    vi.mocked(sendInvitationEmail).mockResolvedValue(undefined);
  });
  it("owner may invite an employee", async () => {
    const dto = await inviteMember(ownerS, { email: "a@x.test", role: "employee" });
    expect(dto.id).toBe("inv-1");
  });
  it("admin (Manager) may invite an employee", async () => {
    const dto = await inviteMember(adminS, { email: "a@x.test", role: "employee" });
    expect(dto.id).toBe("inv-1");
  });
  it("admin may NOT invite another admin (only Owner creates Managers)", async () => {
    await expect(
      inviteMember(adminS, { email: "a@x.test", role: "admin" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(invitationsRepo.create).not.toHaveBeenCalled();
  });
  it("employee may NOT invite (no team.invite grant)", async () => {
    await expect(
      inviteMember(employeeS, { email: "a@x.test", role: "employee" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(invitationsRepo.create).not.toHaveBeenCalled();
  });
});

describe("changeRole — permission + invariants", () => {
  it("owner promotes an employee to admin", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "t1", role: "employee" }),
    );
    vi.mocked(membershipsRepo.updateRole).mockResolvedValue({
      role: "admin",
    } as unknown as Awaited<ReturnType<typeof membershipsRepo.updateRole>>);
    const dto = await changeRole(ownerS, "t1", "admin");
    expect(dto.role).toBe("admin");
  });
  it("admin may NOT promote to admin (escalation invariant)", async () => {
    await expect(changeRole(adminS, "t1", "admin")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
  it("employee may NOT change roles", async () => {
    await expect(changeRole(employeeS, "t1", "employee")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
  it("cannot change own role (anti-self)", async () => {
    await expect(
      changeRole(ownerS, "owner-user", "employee"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("non-existent / cross-org target → NotFound", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(null);
    await expect(changeRole(ownerS, "ghost", "employee")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
  it("admin cannot change an owner's role", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "o2", role: "owner" }),
    );
    await expect(changeRole(adminS, "o2", "employee")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
  it("cannot demote the last active owner", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "o2", role: "owner" }),
    );
    vi.mocked(membershipsRepo.countActiveOwners).mockResolvedValue(1);
    await expect(changeRole(ownerS, "o2", "employee")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("deactivateMember — permission + invariants", () => {
  it("owner deactivates an employee", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "t1", role: "employee", isActive: true }),
    );
    vi.mocked(membershipsRepo.setActive).mockResolvedValue({
      is_active: false,
    } as unknown as Awaited<ReturnType<typeof membershipsRepo.setActive>>);
    const dto = await deactivateMember(ownerS, "t1");
    expect(dto.isActive).toBe(false);
  });
  it("admin deactivates an employee", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "t1", role: "employee", isActive: true }),
    );
    vi.mocked(membershipsRepo.setActive).mockResolvedValue({
      is_active: false,
    } as unknown as Awaited<ReturnType<typeof membershipsRepo.setActive>>);
    const dto = await deactivateMember(adminS, "t1");
    expect(dto.isActive).toBe(false);
  });
  it("employee may NOT deactivate (no team.deactivate grant)", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "t1", role: "employee" }),
    );
    await expect(deactivateMember(employeeS, "t1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(membershipsRepo.setActive).not.toHaveBeenCalled();
  });
  it("admin cannot deactivate an owner", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "o2", role: "owner" }),
    );
    await expect(deactivateMember(adminS, "o2")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
  it("cannot deactivate yourself (anti-self)", async () => {
    await expect(deactivateMember(ownerS, "owner-user")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
  it("cannot deactivate the last active owner", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "o2", role: "owner", isActive: true }),
    );
    vi.mocked(membershipsRepo.countActiveOwners).mockResolvedValue(1);
    await expect(deactivateMember(ownerS, "o2")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
  it("idempotent when already inactive (no write)", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "t1", role: "employee", isActive: false }),
    );
    const dto = await deactivateMember(ownerS, "t1");
    expect(dto.isActive).toBe(false);
    expect(membershipsRepo.setActive).not.toHaveBeenCalled();
  });
  it("non-existent / cross-org target → NotFound", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(null);
    await expect(deactivateMember(ownerS, "ghost")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("setDashboardAccess — owner grants/revokes dashboard access (R4)", () => {
  beforeEach(() => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "emp-1", role: "employee" }),
    );
    vi.mocked(membershipsRepo.setDashboardAccess).mockResolvedValue(
      { dashboard_access: true } as unknown as OrganizationMembership,
    );
  });

  it("owner can grant a member dashboard access", async () => {
    const dto = await setDashboardAccess(ownerS, "emp-1", true);
    expect(membershipsRepo.setDashboardAccess).toHaveBeenCalledWith(
      "emp-1",
      "org-1",
      true,
    );
    expect(dto.dashboardAccess).toBe(true);
  });

  it("owner can revoke a member's access", async () => {
    vi.mocked(membershipsRepo.setDashboardAccess).mockResolvedValue(
      { dashboard_access: false } as unknown as OrganizationMembership,
    );
    const dto = await setDashboardAccess(ownerS, "emp-1", false);
    expect(dto.dashboardAccess).toBe(false);
  });

  it("a non-owner (admin) cannot manage dashboard access", async () => {
    await expect(
      setDashboardAccess(adminS, "emp-1", true),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(membershipsRepo.setDashboardAccess).not.toHaveBeenCalled();
  });

  it("404 when the target is not a member of the org", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(null);
    await expect(
      setDashboardAccess(ownerS, "ghost", true),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to toggle an owner (owners always have access)", async () => {
    vi.mocked(teamRepo.findMemberInOrg).mockResolvedValue(
      memberRow({ userId: "owner-2", role: "owner" }),
    );
    await expect(
      setDashboardAccess(ownerS, "owner-2", false),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(membershipsRepo.setDashboardAccess).not.toHaveBeenCalled();
  });
});
