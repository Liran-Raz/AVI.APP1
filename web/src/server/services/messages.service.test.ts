import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { Message } from "@/server/db/domain.types";
import { ValidationError } from "@/server/errors/app-error";

vi.mock("@/server/repositories/messages.repository", () => ({
  create: vi.fn(),
  findGroup: vi.fn(),
  findThread: vi.fn(),
}));
vi.mock("@/server/repositories/memberships.repository", () => ({
  findByUserAndOrg: vi.fn(),
}));
vi.mock("@/server/repositories/team.repository", () => ({
  findMembersByOrgId: vi.fn(),
}));

import * as messagesRepo from "@/server/repositories/messages.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import { listMessages, sendMessage } from "@/server/services/messages.service";

const ORG = "org-1";
const ME = "user-me";
const OTHER = "user-other";

function session(): FullSession {
  return {
    user: { id: ME },
    profile: { id: ME, role: "employee", full_name: "אני", email: "me@x.test" },
    organization: { id: ORG, name: "משרד" },
    activeOrg: { id: ORG, name: "משרד" },
    activeRole: "employee",
  } as unknown as FullSession;
}

function msg(o: Partial<Message>): Message {
  return {
    id: "m1",
    org_id: ORG,
    sender_id: ME,
    recipient_id: null,
    body: "hello",
    created_at: "2026-07-12T10:00:00.000Z",
    ...o,
  } as Message;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(teamRepo.findMembersByOrgId).mockResolvedValue([
    { userId: ME, fullName: "אני", email: "me@x.test", role: "employee", isActive: true, joinedAt: "", dashboardAccess: false },
    { userId: OTHER, fullName: "עמית", email: "o@x.test", role: "employee", isActive: true, joinedAt: "", dashboardAccess: false },
  ]);
  vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({
    is_active: true,
  } as never);
  vi.mocked(messagesRepo.create).mockImplementation(async (i) => msg(i as Partial<Message>));
});

describe("sendMessage", () => {
  it("sends a group message (recipient_id null) with injected org + sender", async () => {
    const dto = await sendMessage(session(), { body: "שלום לכולם" });
    expect(messagesRepo.create).toHaveBeenCalledWith({
      org_id: ORG,
      sender_id: ME,
      recipient_id: null,
      body: "שלום לכולם",
    });
    expect(dto.recipientId).toBeNull();
    expect(dto.senderName).toBe("אני");
  });

  it("sends a DM to an active member", async () => {
    const dto = await sendMessage(session(), { body: "היי", recipientId: OTHER });
    expect(membershipsRepo.findByUserAndOrg).toHaveBeenCalledWith(OTHER, ORG);
    expect(messagesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_id: OTHER, sender_id: ME, org_id: ORG }),
    );
    expect(dto).toBeDefined();
  });

  it("rejects a DM to a non-member (cross-org / unknown) with ValidationError", async () => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue(null);
    await expect(
      sendMessage(session(), { body: "x", recipientId: "ghost" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(messagesRepo.create).not.toHaveBeenCalled();
  });

  it("rejects a DM to an inactive member", async () => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({ is_active: false } as never);
    await expect(
      sendMessage(session(), { body: "x", recipientId: OTHER }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a DM to yourself", async () => {
    await expect(
      sendMessage(session(), { body: "x", recipientId: ME }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(messagesRepo.create).not.toHaveBeenCalled();
  });
});

describe("listMessages", () => {
  it("lists the office group, normalized to ascending order with sender names", async () => {
    // Repo returns newest-first (no `after`).
    vi.mocked(messagesRepo.findGroup).mockResolvedValue([
      msg({ id: "b", sender_id: OTHER, created_at: "2026-07-12T10:05:00.000Z" }),
      msg({ id: "a", sender_id: ME, created_at: "2026-07-12T10:00:00.000Z" }),
    ]);
    const { items } = await listMessages(session(), { with: "group", limit: 50 });
    expect(items.map((m) => m.id)).toEqual(["a", "b"]); // ascending
    expect(items[1].senderName).toBe("עמית");
    expect(messagesRepo.findGroup).toHaveBeenCalledWith(ORG, { after: undefined, limit: 50 });
  });

  it("lists a DM thread after validating the counterpart is in the org", async () => {
    vi.mocked(messagesRepo.findThread).mockResolvedValue([]);
    await listMessages(session(), { with: OTHER, limit: 50 });
    expect(membershipsRepo.findByUserAndOrg).toHaveBeenCalledWith(OTHER, ORG);
    expect(messagesRepo.findThread).toHaveBeenCalledWith(ORG, ME, OTHER, {
      after: undefined,
      limit: 50,
    });
  });

  it("rejects listing a DM with a non-member", async () => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue(null);
    await expect(
      listMessages(session(), { with: "ghost", limit: 50 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("still lists a DM thread with a DEACTIVATED counterpart (history stays readable)", async () => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({ is_active: false } as never);
    vi.mocked(messagesRepo.findThread).mockResolvedValue([]);
    await expect(
      listMessages(session(), { with: OTHER, limit: 50 }),
    ).resolves.toBeDefined();
    expect(messagesRepo.findThread).toHaveBeenCalledWith(ORG, ME, OTHER, {
      after: undefined,
      limit: 50,
    });
  });
});
