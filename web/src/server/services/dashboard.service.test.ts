import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { UserRole } from "@/server/db/domain.types";
import type { TaskStatsRow } from "@/server/repositories/dashboard.repository";
import { ForbiddenError } from "@/server/errors/app-error";

// Mock the repositories the service composes — the mocked modules never load
// supabase/env. MAX_STATS_ROWS must be provided since vi.mock replaces the whole
// module (the service reads dashboardRepo.MAX_STATS_ROWS).
vi.mock("@/server/repositories/dashboard.repository", () => ({
  findActiveTaskStats: vi.fn(),
  MAX_STATS_ROWS: 5000,
}));
vi.mock("@/server/repositories/team.repository", () => ({
  findMembersByOrgId: vi.fn(),
}));
vi.mock("@/server/repositories/clients.repository", () => ({
  findManyByOrgId: vi.fn(),
}));

import * as dashboardRepo from "@/server/repositories/dashboard.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import * as clientsRepo from "@/server/repositories/clients.repository";
import {
  aggregate,
  canViewDashboard,
  getStats,
  type StatsClient,
  type StatsMember,
} from "@/server/services/dashboard.service";

const ORG = "org-1";

function makeSession(role: UserRole, dashboardAccess = false): FullSession {
  return {
    user: { id: `${role}-user` },
    profile: { id: `${role}-user`, role, full_name: "U", email: "u@x.test" },
    organization: { id: ORG, name: "משרד" },
    activeOrg: { id: ORG, name: "משרד" },
    activeRole: role,
    memberships: [
      {
        orgId: ORG,
        orgName: "משרד",
        orgCode: "X",
        role,
        isActive: true,
        dashboardAccess,
      },
    ],
  } as unknown as FullSession;
}

// Fixed clock so the trend/overdue math is deterministic.
const NOW = Date.parse("2026-07-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString();

function row(o: Partial<TaskStatsRow>): TaskStatsRow {
  return {
    status: "new",
    priority: "normal",
    assigned_to: null,
    client_id: null,
    created_at: daysAgo(1),
    completed_at: null,
    due_at: null,
    ...o,
  };
}

const MEMBERS: StatsMember[] = [
  { userId: "m1", fullName: "מנהל א", isActive: true },
  { userId: "m2", fullName: "מנהל ב", isActive: true },
  { userId: "m3", fullName: "לא פעיל", isActive: false },
];
const CLIENTS: StatsClient[] = [
  { id: "c1", name: "אלפא" },
  { id: "c2", name: "בטא" },
];

// A rich, hand-verified dataset (see the per-row comments).
const ROWS: TaskStatsRow[] = [
  // open, urgent, m1, c1, overdue (due yesterday)
  row({ status: "new", priority: "urgent", assigned_to: "m1", client_id: "c1", created_at: daysAgo(2), due_at: daysAgo(1) }),
  // open, normal, m1, c1, not overdue (due tomorrow)
  row({ status: "in_progress", priority: "normal", assigned_to: "m1", client_id: "c1", created_at: daysAgo(10), due_at: inDays(1) }),
  // done, normal, m2, c2, completed 3d ago
  row({ status: "done", priority: "normal", assigned_to: "m2", client_id: "c2", created_at: daysAgo(20), completed_at: daysAgo(3), due_at: daysAgo(15) }),
  // open, optional, m2, no client, no due
  row({ status: "new", priority: "optional", assigned_to: "m2", client_id: null, created_at: daysAgo(1) }),
  // open, urgent, m3 (INACTIVE) → unassigned bucket, c1, overdue
  row({ status: "new", priority: "urgent", assigned_to: "m3", client_id: "c1", created_at: daysAgo(5), due_at: daysAgo(2) }),
  // open, normal, unassigned (null), c2, created 40d ago (in window)
  row({ status: "in_progress", priority: "normal", assigned_to: null, client_id: "c2", created_at: daysAgo(40) }),
  // open, received (legacy → folds into חדשות), m1, no client, created 100d ago (OUT of 8w window)
  row({ status: "received", priority: "normal", assigned_to: "m1", client_id: null, created_at: daysAgo(100) }),
];

describe("dashboard.service aggregate() — pure math", () => {
  const stats = aggregate(ROWS, MEMBERS, CLIENTS, NOW, false);

  it("computes KPI totals", () => {
    expect(stats.totals).toEqual({ active: 7, open: 6, done: 1, overdue: 2 });
  });

  it("buckets by status (board columns; received folds into חדשות)", () => {
    const byKey = Object.fromEntries(stats.byStatus.map((s) => [s.key, s.count]));
    expect(byKey).toEqual({ todo: 4, in_progress: 2, done: 1 });
  });

  it("counts by priority", () => {
    const byKey = Object.fromEntries(stats.byPriority.map((s) => [s.key, s.count]));
    expect(byKey).toEqual({ urgent: 2, normal: 4, optional: 1 });
  });

  it("computes open load per active member + an unassigned bucket", () => {
    // m1 has 3 open (rows 1,2,7); m2 has 1 (row 4). Inactive m3's open task and
    // the null-assignee open task fall into "לא משויך" (1 + 1 = 2).
    expect(stats.byMember).toEqual([
      { userId: "m1", name: "מנהל א", count: 3 },
      { userId: "m2", name: "מנהל ב", count: 1 },
      { userId: "", name: "לא משויך", count: 2 },
    ]);
  });

  it("builds an 8-week created-vs-completed trend within the window", () => {
    expect(stats.weeklyTrend).toHaveLength(8);
    const totalCreated = stats.weeklyTrend.reduce((s, w) => s + w.created, 0);
    const totalCompleted = stats.weeklyTrend.reduce((s, w) => s + w.completed, 0);
    // 6 of 7 rows created inside the window (the 100-day-old row is excluded).
    expect(totalCreated).toBe(6);
    expect(totalCompleted).toBe(1);
    // Newest bucket: 3 created (rows 1,4,5) + 1 completed (row 3).
    const last = stats.weeklyTrend[stats.weeklyTrend.length - 1];
    expect(last.created).toBe(3);
    expect(last.completed).toBe(1);
  });

  it("ranks top clients by active-task count", () => {
    expect(stats.topClients).toEqual([
      { clientId: "c1", name: "אלפא", count: 3 },
      { clientId: "c2", name: "בטא", count: 2 },
    ]);
  });

  it("passes through the truncated flag", () => {
    expect(aggregate(ROWS, MEMBERS, CLIENTS, NOW, true).truncated).toBe(true);
  });

  it("handles an empty task set (members show zero load, no unassigned bucket)", () => {
    const empty = aggregate([], MEMBERS, CLIENTS, NOW, false);
    expect(empty.totals).toEqual({ active: 0, open: 0, done: 0, overdue: 0 });
    expect(empty.byMember).toEqual([
      { userId: "m1", name: "מנהל א", count: 0 },
      { userId: "m2", name: "מנהל ב", count: 0 },
    ]);
    expect(empty.topClients).toEqual([]);
    expect(empty.weeklyTrend.every((w) => w.created === 0 && w.completed === 0)).toBe(true);
  });
});

describe("dashboard.service getStats() — owner gate + wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dashboardRepo.findActiveTaskStats).mockResolvedValue(ROWS);
    vi.mocked(teamRepo.findMembersByOrgId).mockResolvedValue(
      MEMBERS.map((m) => ({
        userId: m.userId,
        fullName: m.fullName,
        email: `${m.userId}@x.test`,
        role: "employee" as UserRole,
        isActive: m.isActive,
        joinedAt: "2026-01-01T00:00:00.000Z",
        dashboardAccess: false,
      })),
    );
    vi.mocked(clientsRepo.findManyByOrgId).mockResolvedValue(
      CLIENTS.map((c) => ({ id: c.id, name: c.name })) as never,
    );
  });

  it("returns stats for an owner", async () => {
    const stats = await getStats(makeSession("owner"));
    expect(stats.totals.active).toBe(7);
    expect(stats.byStatus.reduce((s, x) => s + x.count, 0)).toBe(7);
    expect(dashboardRepo.findActiveTaskStats).toHaveBeenCalledWith(ORG);
  });

  it("returns stats for a non-owner the owner granted access", async () => {
    const stats = await getStats(makeSession("employee", true));
    expect(stats.totals.active).toBe(7);
    expect(dashboardRepo.findActiveTaskStats).toHaveBeenCalledWith(ORG);
  });

  it("rejects a non-owner without access (admin) with ForbiddenError", async () => {
    await expect(getStats(makeSession("admin", false))).rejects.toBeInstanceOf(ForbiddenError);
    expect(dashboardRepo.findActiveTaskStats).not.toHaveBeenCalled();
  });

  it("rejects a non-owner without access (employee) with ForbiddenError", async () => {
    await expect(getStats(makeSession("employee", false))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("dashboard.service canViewDashboard()", () => {
  it("owner always has access (grant flag irrelevant)", () => {
    expect(canViewDashboard(makeSession("owner", false))).toBe(true);
  });
  it("granted non-owner has access", () => {
    expect(canViewDashboard(makeSession("employee", true))).toBe(true);
    expect(canViewDashboard(makeSession("admin", true))).toBe(true);
  });
  it("non-granted non-owner has no access", () => {
    expect(canViewDashboard(makeSession("employee", false))).toBe(false);
    expect(canViewDashboard(makeSession("admin", false))).toBe(false);
  });
});
