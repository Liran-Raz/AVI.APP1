import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { TaskPriority, TaskStatus } from "@/server/db/domain.types";

// Dashboard repository — read-only, aggregation-oriented reads over `tasks`.
// The owner dashboard (Stage 13 R4) computes all its stats in the service from
// a lean projection of the org's ACTIVE tasks (archived_at IS NULL AND
// deleted_at IS NULL). No new table, no migration — RLS already lets every
// org member read the org's tasks, and the service gates the whole surface to
// the owner. Every query filters org_id explicitly (defense in depth on top of
// RLS: RLS + repo filter + the service injects session.organization.id).
//
// Scale note: for a single office (hundreds of active tasks) a JS aggregation
// in the service is plenty. If a tenant ever grows past MAX_STATS_ROWS active
// tasks, move the GROUP BY into a SECURITY DEFINER RPC — the function signature
// here stays the same. MAX_STATS_ROWS is an explicit ceiling so a runaway org
// can't pull an unbounded payload; we read one over the cap to detect it.

export type TaskStatsRow = {
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string | null;
  client_id: string | null;
  created_at: string;
  completed_at: string | null;
  due_at: string | null;
};

// Generous ceiling for the JS-aggregation path — far above a single office's
// realistic active-task count. If findActiveTaskStats ever returns exactly this
// many rows, the service logs that the dashboard may be truncated (a signal to
// move to an RPC), but never fails.
export const MAX_STATS_ROWS = 5000;

export async function findActiveTaskStats(
  orgId: string,
): Promise<TaskStatsRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "status, priority, assigned_to, client_id, created_at, completed_at, due_at",
    )
    .eq("org_id", orgId)
    .is("archived_at", null)
    .is("deleted_at", null)
    .limit(MAX_STATS_ROWS);
  if (error) throw error;
  return (data as unknown as TaskStatsRow[]) ?? [];
}
