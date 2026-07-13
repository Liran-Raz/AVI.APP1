import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { Message } from "@/server/db/domain.types";
import { ValidationError } from "@/server/errors/app-error";

vi.mock("@/server/repositories/messages.repository", () => ({
  create: vi.fn(),
  findByConversation: vi.fn(),
}));
vi.mock("@/server/repositories/conversations.repository", () => ({
  ensureOffice: vi.fn(),
  ensureDm: vi.fn(),
  findOffice: vi.fn(),
  findDm: vi.fn(),
  getGroupById: vi.fn(),
}));
vi.mock("@/server/repositories/memberships.repository", () => ({
  findByUserAndOrg: vi.fn(),
}));
vi.mock("@/server/repositories/team.repository", () => ({
  findMembersByOrgId: vi.fn(),
}));

import * as messagesRepo from "@/server/repositories/messages.repository";
import * as conversationsRepo from "@/server/repositories/conversations.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import { listMessages, sendMessage } from "@/server/services/messages.service";

const ORG = "org-1";
const ME = "user-me";
const OTHER = "user-other";
const OFFICE_CONV = "office-conv";
const DM_CONV = "dm-conv";
const GROUP_CONV = "22222222-2222-4222-8222-222222222222";

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
    conversation_id: OFFICE_CONV,
    body: "hello",
    created_at: "2026-07-12T10:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    ...o,
  } as Message;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(teamRepo.findMembersByOrgId).mockResolvedValue([
    { userId: ME, fullName: "אני", email: "me@x.test", role: "employee", isActive: true, joinedAt: "", dashboardAccess: false },
    { userId: OTHER, fullName: "עמית", email: "o@x.test", role: "employee", isActive: true, joinedAt: "", dashboardAccess: false },
  ]);
  vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({ is_active: true } as never);
  vi.mocked(messagesRepo.create).mockImplementation(async (i) => msg(i as Partial<Message>));
  vi.mocked(conversationsRepo.ensureOffice).mockResolvedValue(OFFICE_CONV);
  vi.mocked(conversationsRepo.ensureDm).mockResolvedValue(DM_CONV);
  vi.mocked(conversationsRepo.findOffice).mockResolvedValue({ id: OFFICE_CONV, org_id: ORG, kind: "office" } as never);
  vi.mocked(conversationsRepo.findDm).mockResolvedValue({ id: DM_CONV, org_id: ORG, kind: "dm" } as never);
  vi.mocked(conversationsRepo.getGroupById).mockResolvedValue({ id: GROUP_CONV, org_id: ORG, kind: "group" } as never);
});

describe("sendMessage", () => {
  it("sends a group message (recipient null + resolved office conversation)", async () => {
    const dto = await sendMessage(session(), { body: "שלום לכולם" });
    expect(conversationsRepo.ensureOffice).toHaveBeenCalledWith(ORG);
    expect(messagesRepo.create).toHaveBeenCalledWith({
      org_id: ORG,
      sender_id: ME,
      recipient_id: null,
      conversation_id: OFFICE_CONV,
      body: "שלום לכולם",
    });
    expect(dto.recipientId).toBeNull();
    expect(dto.senderName).toBe("אני");
  });

  it("sends a DM to an active member (ensures the dm conversation, keeps recipient_id)", async () => {
    const dto = await sendMessage(session(), { body: "היי", recipientId: OTHER });
    expect(membershipsRepo.findByUserAndOrg).toHaveBeenCalledWith(OTHER, ORG);
    expect(conversationsRepo.ensureDm).toHaveBeenCalledWith(ORG, OTHER);
    expect(messagesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_id: OTHER,
        sender_id: ME,
        org_id: ORG,
        conversation_id: DM_CONV,
      }),
    );
    expect(dto).toBeDefined();
  });

  it("rejects a DM to a non-member (cross-org / unknown) before touching the DB", async () => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue(null);
    await expect(
      sendMessage(session(), { body: "x", recipientId: "ghost" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(conversationsRepo.ensureDm).not.toHaveBeenCalled();
    expect(messagesRepo.create).not.toHaveBeenCalled();
  });

  it("rejects a DM to an inactive member", async () => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({ is_active: false } as never);
    await expect(
      sendMessage(session(), { body: "x", recipientId: OTHER }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(messagesRepo.create).not.toHaveBeenCalled();
  });

  it("rejects a DM to yourself", async () => {
    await expect(
      sendMessage(session(), { body: "x", recipientId: ME }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(conversationsRepo.ensureDm).not.toHaveBeenCalled();
    expect(messagesRepo.create).not.toHaveBeenCalled();
  });
});

describe("listMessages", () => {
  it("lists the office group by its conversation, ascending, with sender names", async () => {
    // Repo returns newest-first (no `after`).
    vi.mocked(messagesRepo.findByConversation).mockResolvedValue([
      msg({ id: "b", sender_id: OTHER, created_at: "2026-07-12T10:05:00.000Z" }),
      msg({ id: "a", sender_id: ME, created_at: "2026-07-12T10:00:00.000Z" }),
    ]);
    const { items } = await listMessages(session(), { with: "group", limit: 50 });
    expect(items.map((m) => m.id)).toEqual(["a", "b"]); // ascending
    expect(items[1].senderName).toBe("עמית");
    expect(conversationsRepo.findOffice).toHaveBeenCalledWith(ORG);
    expect(messagesRepo.findByConversation).toHaveBeenCalledWith(ORG, OFFICE_CONV, {
      after: undefined,
      limit: 50,
    });
  });

  it("returns an empty office feed when no office conversation exists yet", async () => {
    vi.mocked(conversationsRepo.findOffice).mockResolvedValue(null);
    const { items } = await listMessages(session(), { with: "group", limit: 50 });
    expect(items).toEqual([]);
    expect(messagesRepo.findByConversation).not.toHaveBeenCalled();
  });

  it("lists a DM thread after validating the counterpart is in the org", async () => {
    vi.mocked(messagesRepo.findByConversation).mockResolvedValue([]);
    await listMessages(session(), { with: OTHER, limit: 50 });
    expect(membershipsRepo.findByUserAndOrg).toHaveBeenCalledWith(OTHER, ORG);
    expect(conversationsRepo.findDm).toHaveBeenCalledWith(ORG, ME, OTHER);
    expect(messagesRepo.findByConversation).toHaveBeenCalledWith(ORG, DM_CONV, {
      after: undefined,
      limit: 50,
    });
  });

  it("returns an empty DM thread when the two have never messaged (no conversation)", async () => {
    vi.mocked(conversationsRepo.findDm).mockResolvedValue(null);
    const { items } = await listMessages(session(), { with: OTHER, limit: 50 });
    expect(items).toEqual([]);
    expect(messagesRepo.findByConversation).not.toHaveBeenCalled();
  });

  it("rejects listing a DM with a non-member", async () => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue(null);
    await expect(
      listMessages(session(), { with: "ghost", limit: 50 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("still lists a DM thread with a DEACTIVATED counterpart (history stays readable)", async () => {
    vi.mocked(membershipsRepo.findByUserAndOrg).mockResolvedValue({ is_active: false } as never);
    vi.mocked(messagesRepo.findByConversation).mockResolvedValue([]);
    await expect(
      listMessages(session(), { with: OTHER, limit: 50 }),
    ).resolves.toBeDefined();
    expect(conversationsRepo.findDm).toHaveBeenCalledWith(ORG, ME, OTHER);
  });
});

describe("group conversations (Stage 14 / R2)", () => {
  it("sends a group message (recipient null, target = the group conversation)", async () => {
    const dto = await sendMessage(session(), {
      body: "לקבוצה",
      conversationId: GROUP_CONV,
    });
    expect(conversationsRepo.getGroupById).toHaveBeenCalledWith(ORG, GROUP_CONV);
    expect(conversationsRepo.ensureOffice).not.toHaveBeenCalled();
    expect(conversationsRepo.ensureDm).not.toHaveBeenCalled();
    expect(messagesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_id: null,
        conversation_id: GROUP_CONV,
        sender_id: ME,
        org_id: ORG,
      }),
    );
    expect(dto.recipientId).toBeNull();
  });

  it("rejects sending to a group the caller can't read (not a participant / deleted)", async () => {
    vi.mocked(conversationsRepo.getGroupById).mockResolvedValue(null);
    await expect(
      sendMessage(session(), { body: "x", conversationId: GROUP_CONV }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(messagesRepo.create).not.toHaveBeenCalled();
  });

  it("lists a group thread by its conv:<id> address", async () => {
    vi.mocked(messagesRepo.findByConversation).mockResolvedValue([]);
    await listMessages(session(), { with: `conv:${GROUP_CONV}`, limit: 50 });
    expect(conversationsRepo.getGroupById).toHaveBeenCalledWith(ORG, GROUP_CONV);
    expect(messagesRepo.findByConversation).toHaveBeenCalledWith(ORG, GROUP_CONV, {
      after: undefined,
      limit: 50,
    });
  });

  it("returns an empty feed for a group the caller can't read (no leak)", async () => {
    vi.mocked(conversationsRepo.getGroupById).mockResolvedValue(null);
    const { items } = await listMessages(session(), {
      with: `conv:${GROUP_CONV}`,
      limit: 50,
    });
    expect(items).toEqual([]);
    expect(messagesRepo.findByConversation).not.toHaveBeenCalled();
  });
});
