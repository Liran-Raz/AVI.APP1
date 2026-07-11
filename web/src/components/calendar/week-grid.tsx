"use client";

import type { TaskDTO } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import {
  CALENDAR_HOUR_END,
  CALENDAR_HOUR_START,
  dayLabel,
  gridPosition,
  hourRange,
  isToday,
  weekDays,
} from "./calendar-utils";

type Props = {
  weekStart: Date;
  tasks: TaskDTO[];
  clientNameById: Record<string, string>;
  onTaskClick: (task: TaskDTO) => void;
};

// Each task block occupies 30 minutes of vertical space on the grid.
// Hours are 56px tall (HOUR_PX) — easy to read on desktop and still
// roomy on mobile.
const HOUR_PX = 56;
const BLOCK_MIN_HEIGHT = 24;
const BLOCK_FIXED_HEIGHT = HOUR_PX / 2; // 30 min slot

const PRIORITY_BLOCK_CLASS: Record<TaskDTO["priority"], string> = {
  urgent:
    "bg-[var(--priority-urgent)] text-white border-[var(--priority-urgent)]",
  normal: "bg-primary text-primary-foreground border-primary",
  optional:
    "bg-[var(--priority-optional)] text-white border-[var(--priority-optional)]",
};

const STATUS_DECORATION: Record<TaskDTO["status"], string> = {
  new: "",
  received: "ring-2 ring-white/40 ring-offset-1",
  in_progress: "ring-2 ring-white/60 ring-offset-1",
  done: "opacity-60 line-through decoration-2",
};

export function WeekGrid({
  weekStart,
  tasks,
  clientNameById,
  onTaskClick,
}: Props) {
  const days = weekDays(weekStart);
  const hours = hourRange();

  // Bucket tasks by (day, fractional hour) so we can lay them out
  // with absolute positioning inside each day column.
  type Positioned = { task: TaskDTO; hourOffset: number };
  const byDay: Positioned[][] = Array.from({ length: 7 }, () => []);
  const outsideWindow: TaskDTO[] = [];
  for (const t of tasks) {
    // Tasks with no due date don't belong on the calendar. The list query is
    // windowed by dueAfter/dueBefore so nulls don't arrive here anyway — this
    // is a type guard now that dueAt is nullable (Stage 12).
    if (!t.dueAt) continue;
    const pos = gridPosition(t.dueAt, weekStart);
    if (!pos) {
      outsideWindow.push(t);
      continue;
    }
    byDay[pos.dayIndex].push({ task: t, hourOffset: pos.hourOffset });
  }
  for (const arr of byDay) arr.sort((a, b) => a.hourOffset - b.hourOffset);

  const totalHours = CALENDAR_HOUR_END - CALENDAR_HOUR_START;
  const gridHeight = totalHours * HOUR_PX;

  return (
    <div className="border border-border rounded-lg glass-card shadow-card overflow-hidden">
      {/* Horizontal scroll on narrow screens: at ~720px the day
          columns become readable; below that we let the user pan
          rather than squishing every column to a few pixels. */}
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
      {/* Day header row (the actual grid lives below) */}
      <div
        className="grid bg-muted/40 border-b border-border"
        style={{ gridTemplateColumns: `60px repeat(7, minmax(0, 1fr))` }}
      >
        <div /> {/* spacer for hour axis */}
        {days.map((d) => (
          <div
            key={d.toISOString()}
            className={cn(
              "text-center py-2 text-xs font-medium border-r border-border last:border-r-0",
              isToday(d) && "bg-primary/5 text-primary font-bold",
            )}
          >
            {dayLabel(d)}
          </div>
        ))}
      </div>

      {/* Body — hour axis + 7 day columns. Tasks are absolutely
          positioned inside each day column. */}
      <div
        className="grid relative"
        style={{
          gridTemplateColumns: `60px repeat(7, minmax(0, 1fr))`,
          height: gridHeight,
        }}
      >
        {/* Hour labels on the right (RTL: visually it's the right axis) */}
        <div className="flex flex-col text-xs text-muted-foreground">
          {hours.map((h) => (
            <div
              key={h}
              className="flex items-start justify-end pr-2 pt-1 border-b border-border last:border-b-0"
              style={{ height: HOUR_PX }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* 7 day columns */}
        {days.map((d, dayIdx) => (
          <div
            key={d.toISOString()}
            className={cn(
              "relative border-r border-border last:border-r-0",
              isToday(d) && "bg-primary/5",
            )}
          >
            {/* Hour gridlines */}
            {hours.map((h) => (
              <div
                key={h}
                className="border-b border-border last:border-b-0"
                style={{ height: HOUR_PX }}
              />
            ))}

            {/* Task blocks */}
            {byDay[dayIdx].map(({ task, hourOffset }) => {
              const top = hourOffset * HOUR_PX;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onTaskClick(task)}
                  className={cn(
                    "absolute mx-1 rounded-md border px-2 py-1 text-start text-xs shadow-card",
                    "hover:shadow-overlay transition-shadow cursor-pointer overflow-hidden",
                    PRIORITY_BLOCK_CLASS[task.priority],
                    STATUS_DECORATION[task.status],
                  )}
                  style={{
                    top,
                    insetInlineStart: "4px",
                    insetInlineEnd: "4px",
                    height: Math.max(BLOCK_MIN_HEIGHT, BLOCK_FIXED_HEIGHT),
                  }}
                  aria-label={`משימה: ${task.title}`}
                >
                  <div className="font-semibold truncate">{task.title}</div>
                  {task.clientId && clientNameById[task.clientId] && (
                    <div className="truncate text-[10px] opacity-80">
                      {clientNameById[task.clientId]}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
        </div>
      </div>

      {/* Tasks outside the hour window (e.g., at 06:00) are not
          dropped — they get a small footer row so the user can still
          see them. */}
      {outsideWindow.length > 0 && (
        <div className="border-t border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium">{outsideWindow.length}</span> משימות
          מחוץ לטווח השעות המוצג בשבוע הזה.
        </div>
      )}
    </div>
  );
}
