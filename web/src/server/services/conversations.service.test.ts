import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";

vi.mock("@/server/repositories/conversations.repository", () => ({
  listMyGroupParticipations: vi.fn(),
  findGroupsByIds: vi.fn(),
  listActiveParticipants: vi.fn(),
  getGroupById: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  leaveGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));
vi.mock("@/server/repositories/team.repository", () => ({
  findMembersByOrgId: vi.fn(),
}));

import * as convRepo from "@/server/repositories/conversations.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import {
  addMember,
  getGroupDetail,
  listMyGroups,
  renameGroup,
} from "@/server/services/conversations.service";

const ORG = "org-1";
const ME = "user-me";

function session(): FullSession {
  return {
    user: { id: ME },
    profile: { id: ME, role: "employee", full_name: "אני", email: "me@x.test" },
    organization: { id: ORG, name: "משרד" },
    activeOrg: { id: ORG, name: "משרד" },
    activeRole: "employee",
  } as unknown as FullSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(teamRepo.findMembersByOrgId).mockResolvedValue([
    { userId: ME, fullName: "אני", email: "", role: "employee", isActive: true, joinedAt: "", dashboardAccess: false },
    { userId: "u2", fullName: "עמית", email: "", role: "employee", isActive: true, joinedAt: "", dashboardAccess: false },
  ]);
});

describe("listMyGroups", () => {
  it("returns groups newest-activity-first with member counts + my isAdmin", async () => {
    vi.mocked(convRepo.listMyGroupParticipations).mockResolvedValue([
      { conversationId: "g1", isAdmin: true },
      { conversationId: "g2", isAdmin: false },
    ]);
    vi.mocked(convRepo.findGroupsByIds).mockResolvedValue([
      { id: "g1", org_id: ORG, kind: "group", title: "מיסים", last_message_at: "2026-07-12T09:00:00+00:00" },
      { id: "g2", org_id: ORG, kind: "group", title: "הנהלה", last_message_at: "2026-07-12T11:00:00+00:00" },
    ] as never);
    vi.mocked(convRepo.listActiveParticipants).mockResolvedValue([
      { conversation_id: "g1", user_id: ME, is_admin: true, joined_at: "" },
      { conversation_id: "g1", user_id: "u2", is_admin: false, joined_at: "" },
      { conversation_id: "g2", user_id: ME, is_admin: false, joined_at: "" },
    ]);

    const { items } = await listMyGroups(session());
    expect(items.map((g) => g.id)).toEqual(["g2", "g1"]); // g2 has newer activity
    const g1 = items.find((g) => g.id === "g1")!;
    expect(g1.isAdmin).toBe(true);
    expect(g1.memberCount).toBe(2);
    const g2 = items.find((g) => g.id === "g2")!;
    expect(g2.isAdmin).toBe(false);
    expect(g2.memberCount).toBe(1);
  });

  it("returns empty when the caller is in no groups (no extra reads)", async () => {
    vi.mocked(convRepo.listMyGroupParticipations).mockResolvedValue([]);
    const { items } = await listMyGroups(session());
    expect(items).toEqual([]);
    expect(convRepo.findGroupsByIds).not.toHaveBeenCalled();
  });
});

describe("getGroupDetail", () => {
  it("404s when the group isn't readable (not a participant / deleted)", async () => {
    vi.mocked(convRepo.getGroupById).mockResolvedValue(null);
    await expect(getGroupDetail(session(), "gX")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("resolves member names and computes the caller's isAdmin", async () => {
    vi.mocked(convRepo.getGroupById).mockResolvedValue({
      id: "g1", org_id: ORG, kind: "group", title: "מיסים",
    } as never);
    vi.mocked(convRepo.listActiveParticipants).mockResolvedValue([
      { conversation_id: "g1", user_id: ME, is_admin: true, joined_at: "" },
      { conversation_id: "g1", user_id: "u2", is_admin: false, joined_at: "" },
    ]);

    const d = await getGroupDetail(session(), "g1");
    expect(d.isAdmin).toBe(true);
    expect(d.members).toHaveLength(2);
    expect(d.members.find((m) => m.id === "u2")!.name).toBe("עמית");
  });
});

describe("RPC error mapping", () => {
  it("maps SQLSTATE 42501 (not authorized) to ForbiddenError", async () => {
    vi.mocked(convRepo.renameGroup).mockRejectedValue({ code: "42501", message: "only admin" });
    await expect(renameGroup(session(), "g1", "חדש")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("maps SQLSTATE 22023 (invalid argument) to ValidationError", async () => {
    vi.mocked(convRepo.addMember).mockRejectedValue({ code: "22023", message: "not a member" });
    await expect(addMember(session(), "g1", "u2")).rejects.toBeInstanceOf(ValidationError);
  });
});
