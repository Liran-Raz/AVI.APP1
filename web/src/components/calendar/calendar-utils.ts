// Week-math helpers for the calendar. RTL Israeli week (Sun..Sat).
// We use date-fns for the heavy lifting; week starts on Sunday.

import {
  addDays,
  addWeeks,
  endOfWeek as dfEndOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  startOfDay,
  startOfWeek as dfStartOfWeek,
} from "date-fns";
import { he } from "date-fns/locale";

// Display hours on the calendar grid. Israeli accountant business
// hours bias the window — early start, late evening allowed for
// emergency tasks.
export const CALENDAR_HOUR_START = 8;
export const CALENDAR_HOUR_END = 20; // exclusive (last shown hour label = 19)

export const HEBREW_WEEKDAY_SHORT = [
  "א'", // Sunday
  "ב'", // Monday
  "ג'", // Tuesday
  "ד'", // Wednesday
  "ה'", // Thursday
  "ו'", // Friday
  "ש'", // Saturday
];

export function startOfWeek(d: Date): Date {
  return dfStartOfWeek(d, { weekStartsOn: 0 });
}

export function endOfWeek(d: Date): Date {
  return dfEndOfWeek(d, { weekStartsOn: 0 });
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function nextWeek(weekStart: Date): Date {
  return addWeeks(weekStart, 1);
}

export function prevWeek(weekStart: Date): Date {
  return addWeeks(weekStart, -1);
}

export function hourRange(): number[] {
  // 08, 09, ..., 19
  return Array.from(
    { length: CALENDAR_HOUR_END - CALENDAR_HOUR_START },
    (_, i) => CALENDAR_HOUR_START + i,
  );
}

// Hebrew display string for the week range: "26-30 במאי" or, when the
// week spans two months, "30 במאי - 5 ביוני".
export function formatWeekRange(weekStart: Date): string {
  const ws = weekStart;
  const we = endOfWeek(weekStart);
  const sameMonth = ws.getMonth() === we.getMonth();
  if (sameMonth) {
    return `${ws.getDate()}-${we.getDate()} ${format(we, "MMMM", { locale: he })}`;
  }
  return `${format(ws, "d במLLLL", { locale: he })} - ${format(we, "d במLLLL", { locale: he })}`;
}

export function dayLabel(d: Date): string {
  // "א'" + "26"
  return `${HEBREW_WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}`;
}

// Position of a task (by its due_at ISO) on the calendar grid.
// Returns null if the task falls outside the visible week or outside
// the visible hour window — caller decides what to do (e.g., show in
// an "outside hours" footer).
export type GridPosition = {
  /** 0..6, index into the week's days array */
  dayIndex: number;
  /** fractional hour from CALENDAR_HOUR_START (e.g. 1.5 = 09:30 if start=8) */
  hourOffset: number;
};

export function gridPosition(
  dueAtIso: string,
  weekStart: Date,
): GridPosition | null {
  const due = new Date(dueAtIso);
  if (Number.isNaN(due.getTime())) return null;
  const we = endOfWeek(weekStart);
  if (
    !isWithinInterval(due, {
      start: startOfDay(weekStart),
      end: we,
    })
  ) {
    return null;
  }
  const dayIndex = weekDays(weekStart).findIndex((d) => isSameDay(d, due));
  if (dayIndex < 0) return null;
  const hourOffset =
    due.getHours() + due.getMinutes() / 60 - CALENDAR_HOUR_START;
  if (
    hourOffset < 0 ||
    hourOffset >= CALENDAR_HOUR_END - CALENDAR_HOUR_START
  ) {
    return null;
  }
  return { dayIndex, hourOffset };
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}
