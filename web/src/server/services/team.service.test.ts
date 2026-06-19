import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmailDeliveryError } from "@/server/email/email-errors";
import type { FullSession } from "@/server/auth/session";
import type { Invitation } from "@/server/db/database.types";

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
}));
vi.mock("@/server/services/emails.service", () => ({
  sendInvitationEmail: vi.fn(),
}));

import * as invitationsRepo from "@/server/repositories/invitations.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import { sendInvitationEmail } from "@/server/services/emails.service";
import { inviteMember } from "@/server/services/team.service";

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
