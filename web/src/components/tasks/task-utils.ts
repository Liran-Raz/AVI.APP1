// Hebrew labels and helper mappings for tasks UI. Kept in one place so
// the Kanban columns, the card chips, the form selects, and the filter
// menus render the same text and respect the same status grouping.

import type {
  LifecycleFilter,
  TaskPriorityValue,
  TaskStatusValue,
} from "@/lib/api-client";

export const STATUS_LABELS: Record<TaskStatusValue, string> = {
  new: "חדשה",
  received: "התקבל", // legacy: retired from the flow, kept for defensive rendering
  in_progress: "במעקב",
  done: "הושלמה",
};

export const PRIORITY_LABELS: Record<TaskPriorityValue, string> = {
  urgent: "דחוף",
  normal: "רגיל",
  optional: "עתידי",
};

export const LIFECYCLE_LABELS: Record<LifecycleFilter, string> = {
  active: "פעילות",
  archived: "בארכיון",
  deleted: "מחוקות",
  all: "הכל",
};

// Personal-board columns (Stage 12 Round C). The list query (boardFor) already
// returns exactly the viewer's assignee-side new/in_progress tasks plus their
// creator-side done tasks, so grouping by status yields the three columns:
//   חדשות  = new (assigned to the viewer)
//   במעקב  = in_progress (assigned to the viewer)
//   הושלמו = done (created by the viewer — returned for verification → archive)
// 'received' is legacy and buckets with "חדשות" defensively (none are produced).
export type KanbanColumnKey = "todo" | "in_progress" | "done";

export const KANBAN_COLUMNS: ReadonlyArray<{
  key: KanbanColumnKey;
  label: string;
  statuses: ReadonlyArray<TaskStatusValue>;
}> = [
  { key: "todo", label: "חדשות", statuses: ["new", "received"] },
  { key: "in_progress", label: "במעקב", statuses: ["in_progress"] },
  { key: "done", label: "הושלמו", statuses: ["done"] },
];

export function kanbanColumnForStatus(
  status: TaskStatusValue,
): KanbanColumnKey {
  for (const col of KANBAN_COLUMNS) {
    if (col.statuses.includes(status)) return col.key;
  }
  return "todo"; // fallback
}

// Suggested next status when the user clicks "advance" on a card.
// Returns null if the task is already done.
export function nextStatus(status: TaskStatusValue): TaskStatusValue | null {
  switch (status) {
    case "new":
      return "in_progress";
    // 'received' is retired from the flow (Stage 12): the promotion path is
    // new → in_progress → done. The enum value stays in the DB/types only for
    // defensive rendering of any legacy row, which also advances to in_progress.
    case "received":
      return "in_progress";
    case "in_progress":
      return "done";
    case "done":
      return null;
  }
}

// Format a due_at ISO timestamp as a short Hebrew date+time string.
// "יום שני, 26 במאי 18:00".
export function formatDueAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Per-org task number as a short display code: 1 -> "#0001". The UI shows
// digits only; the system identity (org_code + number) is not surfaced here.
export function formatTaskNumber(n: number): string {
  return `#${String(n).padStart(4, "0")}`;
}

// Creation timestamp for the card ("נוצרה ב…"). Short he-IL date + time.
export function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Returns 'overdue' | 'today' | 'soon' | 'later' based on now.
// Used to colour the due-date chip on a card.
export function dueState(iso: string): "overdue" | "today" | "soon" | "later" {
  const due = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = due - now;
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (diffMs < 0) return "overdue";
  if (diffMs < oneDayMs) return "today";
  if (diffMs < 3 * oneDayMs) return "soon";
  return "later";
}

// Default due_at for new tasks: today at 18:00 in the local timezone,
// formatted for an <input type="datetime-local"> value (no seconds, no
// timezone). Liran's preference: tasks default to "end of today".
export function defaultDueAtLocal(): string {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  // YYYY-MM-DDTHH:mm for datetime-local input
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Convert a datetime-local input value back to a full ISO string for
// the API. The input is local time; new Date(input) interprets that
// correctly, and toISOString gives us UTC.
export function localDatetimeToISO(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

// And back: ISO -> datetime-local for the form to display.
export function isoToLocalDatetime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
