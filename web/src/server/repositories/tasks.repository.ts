import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";
import type {
  Task,
  TaskPriority,
  TaskStatus,
} from "@/server/db/domain.types";
import type { LifecycleFilter } from "@/server/validators/tasks.schema";

// Tasks repository — the only place outside the Supabase client factory
// that knows how `tasks` rows are read or written. Every query filters
// org_id explicitly (defense in depth on top of RLS) and respects the
// lifecycle columns (archived_at, deleted_at).

type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];
type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

export type ListTasksOptions = {
  search?: string;
  status?: TaskStatus[];
  priority?: TaskPriority;
  assignedTo?: string;
  clientId?: string;
  // Personal board (Stage 12): a validated user id. When set, overrides
  // status/assignedTo with the board's OR-predicate (see below).
  boardFor?: string;
  lifecycle: LifecycleFilter;
  dueBefore?: string;
  dueAfter?: string;
  limit: number;
  offset: number;
};

export async function findManyByOrgId(
  orgId: string,
  opts: ListTasksOptions,
): Promise<Task[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("tasks")
    .select("*")
    .eq("org_id", orgId)
    .order("due_at", { ascending: true })
    .order("created_at", { ascending: true });

  // Lifecycle composition.
  // We apply explicit filters even though partial indexes already gate
  // the planner — the explicit predicates ensure correctness regardless
  // of which index is chosen.
  switch (opts.lifecycle) {
    case "active":
      query = query.is("archived_at", null).is("deleted_at", null);
      break;
    case "archived":
      query = query.not("archived_at", "is", null).is("deleted_at", null);
      break;
    case "deleted":
      query = query.not("deleted_at", "is", null);
      break;
    case "all":
      // no extra filter
      break;
  }

  // Personal board (Stage 12 Round C) overrides status/assignedTo: a task sits
  // on its ASSIGNEE's board while new/in_progress, and returns to its CREATOR's
  // board once done. boardFor is a validated uuid (no injection). This .or()
  // composes with the search .or() below via AND (separate top-level groups).
  if (opts.boardFor) {
    const uid = opts.boardFor;
    query = query.or(
      `and(assigned_to.eq.${uid},status.in.(new,in_progress)),and(creator_id.eq.${uid},status.eq.done)`,
    );
  } else {
    if (opts.status && opts.status.length > 0) {
      query = query.in("status", opts.status);
    }
    if (opts.assignedTo) {
      query = query.eq("assigned_to", opts.assignedTo);
    }
  }
  if (opts.priority) {
    query = query.eq("priority", opts.priority);
  }
  if (opts.clientId) {
    query = query.eq("client_id", opts.clientId);
  }
  if (opts.dueAfter) {
    query = query.gte("due_at", opts.dueAfter);
  }
  if (opts.dueBefore) {
    query = query.lte("due_at", opts.dueBefore);
  }

  if (opts.search) {
    // Search across title and description. Term was sanitized by the
    // validator (no commas, parens, quotes, or LIKE wildcards).
    const term = opts.search;
    query = query.or(
      `title.ilike.%${term}%,description.ilike.%${term}%`,
    );
  }

  query = query.range(opts.offset, opts.offset + opts.limit - 1);

  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as Task[]) ?? [];
}

export async function findByIdAndOrgId(
  id: string,
  orgId: string,
): Promise<Task | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Task | null) ?? null;
}

export async function create(input: TaskInsert): Promise<Task> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert(input as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Task;
}

export async function updateByIdAndOrgId(
  id: string,
  orgId: string,
  patch: TaskUpdate,
): Promise<Task | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(patch as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Task | null) ?? null;
}

export async function setStatus(
  id: string,
  orgId: string,
  status: TaskStatus,
): Promise<Task | null> {
  // The DB trigger tasks_set_completed_at handles completed_at when
  // status crosses the done boundary — no need to touch it here.
  return updateByIdAndOrgId(id, orgId, { status });
}

export async function setArchived(
  id: string,
  orgId: string,
  archived: boolean,
): Promise<Task | null> {
  return updateByIdAndOrgId(id, orgId, {
    archived_at: archived ? new Date().toISOString() : null,
  });
}

export async function setDeleted(
  id: string,
  orgId: string,
  deleted: boolean,
): Promise<Task | null> {
  return updateByIdAndOrgId(id, orgId, {
    deleted_at: deleted ? new Date().toISOString() : null,
  });
}

// Cheap "did anything change?" signal for live board polling (Stage 13 R6):
// the org's task count plus the newest updated_at. Every insert / status /
// assignment / archive / delete bumps updated_at (set_updated_at trigger) or
// the count, so the returned string changes. Returns NO task rows — a tiny
// payload safe to poll every few seconds.
export async function getBoardVersion(orgId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, count, error } = await supabase
    .from("tasks")
    .select("updated_at", { count: "exact" })
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const maxUpdated =
    (data as { updated_at: string }[] | null)?.[0]?.updated_at ?? "";
  return `${count ?? 0}:${maxUpdated}`;
}
