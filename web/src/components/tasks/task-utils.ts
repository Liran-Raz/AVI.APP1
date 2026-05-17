// Hebrew labels and helper mappings for tasks UI. Kept in one place so
// the Kanban columns, the card chips, the form selects, and the filter
// menus render the same text and respect the same status grouping.

import type {
  LifecycleFilter,
  TaskPriorityValue,
  TaskStatusValue,
} from "@/lib/api-client";

export const STATUS_LABELS: Record<TaskStatusValue, string> = {
  new: "חדש",
  received: "התקבל",
  in_progress: "בתהליך",
  done: "הושלם",
};

export const PRIORITY_LABELS: Record<TaskPriorityValue, string> = {
  urgent: "דחוף",
  normal: "רגיל",
  optional: "סופני",
};

export const LIFECYCLE_LABELS: Record<LifecycleFilter, string> = {
  active: "פעילות",
  archived: "בארכיון",
  deleted: "מחוקות",
  all: "הכל",
};

// Kanban column model. The grouping bundles new + received under
// "לביצוע" (to do) because Liran asked for a 3-column Kanban
// rather than four. The DB still tracks them as separate statuses
// so future views can distinguish them.
export type KanbanColumnKey = "todo" | "in_progress" | "done";

export const KANBAN_COLUMNS: ReadonlyArray<{
  key: KanbanColumnKey;
  label: string;
  statuses: ReadonlyArray<TaskStatusValue>;
}> = [
  { key: "todo", label: "לביצוע", statuses: ["new", "received"] },
  { key: "in_progress", label: "בתהליך", statuses: ["in_progress"] },
  { key: "done", label: "הושלם", statuses: ["done"] },
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
      return "received";
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
export function formatDueAt(iso: string): string {
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
export function isoToLocalDatetime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
