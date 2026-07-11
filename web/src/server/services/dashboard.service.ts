import "server-only";

import type { FullSession } from "@/server/auth/session";
import { ForbiddenError } from "@/server/errors/app-error";
import * as dashboardRepo from "@/server/repositories/dashboard.repository";
import type { TaskStatsRow } from "@/server/repositories/dashboard.repository";
import * as teamRepo from "@/server/repositories/team.repository";
import * as clientsRepo from "@/server/repositories/clients.repository";
import type { TaskPriority, TaskStatus } from "@/server/db/domain.types";

// ============================================================
// Owner dashboard (Stage 13 R4).
//
// Owner-only management analytics. Every metric is computed in JS from a lean
// projection of the org's ACTIVE tasks (see dashboard.repository) — no new
// table, no migration. The owner gate lives HERE (the service is the trust
// boundary); the page + nav hide the surface for non-owners but never enforce.
//
// The aggregation is a PURE function (aggregate) taking the rows, the team
// roster, the client roster, and `nowMs` so it is fully deterministic and
// unit-testable without a clock or a database.
// ============================================================

// Status buckets mirror the personal board columns (KANBAN_COLUMNS): the legacy
// 'received' value folds into "חדשות" (none are produced post-Stage-12, kept for
// defensive rendering). Order is board order: new → in progress → done.
type StatusBucketKey = "todo" | "in_progress" | "done";

const STATUS_BUCKETS: ReadonlyArray<{
  key: StatusBucketKey;
  label: string;
  statuses: ReadonlyArray<TaskStatus>;
  colorVar: string;
}> = [
  { key: "todo", label: "חדשות", statuses: ["new", "received"], colorVar: "--status-new" },
  { key: "in_progress", label: "במעקב", statuses: ["in_progress"], colorVar: "--status-in-progress" },
  { key: "done", label: "הושלמו", statuses: ["done"], colorVar: "--status-done" },
];

const PRIORITY_META: ReadonlyArray<{
  priority: TaskPriority;
  label: string;
  colorVar: string;
}> = [
  { priority: "urgent", label: "דחוף", colorVar: "--priority-urgent" },
  { priority: "normal", label: "רגיל", colorVar: "--priority-normal" },
  { priority: "optional", label: "עתידי", colorVar: "--priority-optional" },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TREND_WEEKS = 8;
const TOP_CLIENTS = 5;
const MAX_MEMBER_BARS = 12;

// An open task is one still on someone's board: new / received / in_progress
// (i.e. not done). "Load" per member counts these.
const OPEN_STATUSES: ReadonlyArray<TaskStatus> = ["new", "received", "in_progress"];

// ============================================================
// DTO — what the API exposes. Small, camelCase, no org_id / no PII beyond the
// member/client display names the owner already sees elsewhere.
// ============================================================

export type CountSlice = {
  key: string;
  label: string;
  count: number;
  // A CSS custom-property name (e.g. "--status-done") the SVG charts read via
  // var(...) so colors stay theme-aware and consistent with the rest of the app.
  colorVar: string;
};

export type MemberLoad = {
  userId: string; // "" for the synthetic "unassigned" bucket
  name: string;
  count: number;
};

export type TopClient = {
  clientId: string;
  name: string;
  count: number;
};

export type WeekPoint = {
  weekStart: string; // ISO — the component formats it he-IL
  created: number;
  completed: number;
};

export type DashboardStatsDTO = {
  generatedAt: string;
  // KPI cards.
  totals: {
    active: number; // all active-lifecycle tasks
    open: number; // new + received + in_progress
    done: number; // done (still active-lifecycle, i.e. not archived)
    overdue: number; // due_at < now AND not done
  };
  byStatus: CountSlice[];
  byPriority: CountSlice[];
  byMember: MemberLoad[]; // open-task load per active member (desc), capped
  weeklyTrend: WeekPoint[]; // created vs completed, last 8 weeks (chronological)
  topClients: TopClient[]; // active tasks per client (desc), top 5
  // True when the projection hit the repository ceiling — the numbers may be a
  // lower bound. Surfaced so the UI can show an honest note instead of silently
  // under-reporting.
  truncated: boolean;
};

// A minimal member shape the aggregator needs (from the team roster).
export type StatsMember = {
  userId: string;
  fullName: string;
  isActive: boolean;
};

// A minimal client shape the aggregator needs.
export type StatsClient = {
  id: string;
  name: string;
};

// Dashboard visibility (Stage 13 R4). The owner always has access; any other
// member has access only if the owner granted it (membership.dashboardAccess,
// migration 0022). Reads the flag off the session (no extra query). This is the
// authoritative gate; the page/nav are display-only.
export function canViewDashboard(session: FullSession): boolean {
  if (session.activeRole === "owner") return true;
  const active = session.memberships.find(
    (m) => m.orgId === session.organization.id,
  );
  return active?.dashboardAccess === true;
}

function assertCanViewDashboard(session: FullSession): void {
  if (!canViewDashboard(session)) {
    throw new ForbiddenError("Dashboard access required");
  }
}

// ------------------------------------------------------------
// Pure aggregation — deterministic given (rows, members, clients, nowMs).
// Exported for direct unit testing.
// ------------------------------------------------------------
export function aggregate(
  rows: TaskStatsRow[],
  members: StatsMember[],
  clients: StatsClient[],
  nowMs: number,
  truncated: boolean,
): DashboardStatsDTO {
  const isDone = (s: TaskStatus) => s === "done";

  // --- KPI totals ---
  let open = 0;
  let done = 0;
  let overdue = 0;
  for (const r of rows) {
    if (isDone(r.status)) {
      done += 1;
    } else {
      open += 1;
      if (r.due_at) {
        const dueMs = Date.parse(r.due_at);
        if (!Number.isNaN(dueMs) && dueMs < nowMs) overdue += 1;
      }
    }
  }
  const active = rows.length;

  // --- by status (board buckets) ---
  const statusToBucket = new Map<TaskStatus, StatusBucketKey>();
  for (const b of STATUS_BUCKETS) {
    for (const s of b.statuses) statusToBucket.set(s, b.key);
  }
  const bucketCounts = new Map<StatusBucketKey, number>();
  for (const r of rows) {
    const key = statusToBucket.get(r.status) ?? "todo";
    bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
  }
  const byStatus: CountSlice[] = STATUS_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    count: bucketCounts.get(b.key) ?? 0,
    colorVar: b.colorVar,
  }));

  // --- by priority ---
  const priorityCounts = new Map<TaskPriority, number>();
  for (const r of rows) {
    priorityCounts.set(r.priority, (priorityCounts.get(r.priority) ?? 0) + 1);
  }
  const byPriority: CountSlice[] = PRIORITY_META.map((p) => ({
    key: p.priority,
    label: p.label,
    count: priorityCounts.get(p.priority) ?? 0,
    colorVar: p.colorVar,
  }));

  // --- by member (open-task load) ---
  const openByAssignee = new Map<string | null, number>();
  for (const r of rows) {
    if (OPEN_STATUSES.includes(r.status)) {
      openByAssignee.set(
        r.assigned_to,
        (openByAssignee.get(r.assigned_to) ?? 0) + 1,
      );
    }
  }
  const activeMembers = members.filter((m) => m.isActive);
  const memberLoads: MemberLoad[] = activeMembers.map((m) => ({
    userId: m.userId,
    name: m.fullName || "—",
    count: openByAssignee.get(m.userId) ?? 0,
  }));
  // An open task assigned to a now-inactive member (or to nobody) still counts —
  // surface it as "לא משויך" so the totals reconcile with the KPI.
  const knownIds = new Set(activeMembers.map((m) => m.userId));
  let unassignedOpen = 0;
  for (const [assignee, cnt] of openByAssignee) {
    if (assignee === null || !knownIds.has(assignee)) unassignedOpen += cnt;
  }
  memberLoads.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "he"));
  const byMember: MemberLoad[] = memberLoads.slice(0, MAX_MEMBER_BARS);
  if (unassignedOpen > 0) {
    byMember.push({ userId: "", name: "לא משויך", count: unassignedOpen });
  }

  // --- weekly trend (created vs completed), last TREND_WEEKS weeks ---
  const buckets = Array.from({ length: TREND_WEEKS }, (_, i) => {
    const end = nowMs - (TREND_WEEKS - 1 - i) * WEEK_MS;
    const start = end - WEEK_MS;
    return { start, end, created: 0, completed: 0 };
  });
  const windowStart = buckets[0].start;
  const bucketFor = (ms: number): number => {
    if (ms < windowStart || ms >= nowMs) return -1;
    const idx = Math.floor((ms - windowStart) / WEEK_MS);
    return idx >= 0 && idx < TREND_WEEKS ? idx : -1;
  };
  for (const r of rows) {
    const createdMs = Date.parse(r.created_at);
    if (!Number.isNaN(createdMs)) {
      const bi = bucketFor(createdMs);
      if (bi >= 0) buckets[bi].created += 1;
    }
    if (r.completed_at) {
      const completedMs = Date.parse(r.completed_at);
      if (!Number.isNaN(completedMs)) {
        const bi = bucketFor(completedMs);
        if (bi >= 0) buckets[bi].completed += 1;
      }
    }
  }
  const weeklyTrend: WeekPoint[] = buckets.map((b) => ({
    weekStart: new Date(b.start).toISOString(),
    created: b.created,
    completed: b.completed,
  }));

  // --- top clients by active-task count ---
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const clientCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.client_id) {
      clientCounts.set(r.client_id, (clientCounts.get(r.client_id) ?? 0) + 1);
    }
  }
  const topClients: TopClient[] = [...clientCounts.entries()]
    .map(([clientId, count]) => ({
      clientId,
      name: clientName.get(clientId) ?? "לקוח שהוסר",
      count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "he"))
    .slice(0, TOP_CLIENTS);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    totals: { active, open, done, overdue },
    byStatus,
    byPriority,
    byMember,
    weeklyTrend,
    topClients,
    truncated,
  };
}

// ------------------------------------------------------------
// Public API — owner-gated. Loads the projection + rosters, then aggregates.
// ------------------------------------------------------------
export async function getStats(session: FullSession): Promise<DashboardStatsDTO> {
  assertCanViewDashboard(session);
  const orgId = session.organization.id;

  const [rows, memberRows, clientRows] = await Promise.all([
    dashboardRepo.findActiveTaskStats(orgId),
    teamRepo.findMembersByOrgId(orgId),
    clientsRepo.findManyByOrgId(orgId, {
      status: "all",
      limit: 1000,
      offset: 0,
    }),
  ]);

  const members: StatsMember[] = memberRows.map((m) => ({
    userId: m.userId,
    fullName: m.fullName,
    isActive: m.isActive,
  }));
  const clients: StatsClient[] = clientRows.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const truncated = rows.length >= dashboardRepo.MAX_STATS_ROWS;
  return aggregate(rows, members, clients, Date.now(), truncated);
}
