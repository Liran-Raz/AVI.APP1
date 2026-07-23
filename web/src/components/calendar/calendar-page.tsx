"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ApiError,
  apiClient,
  type ClientDTO,
  type ListTasksQuery,
  type MemberDTO,
  type TaskDTO,
} from "@/lib/api-client";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";

import {
  endOfWeek,
  formatWeekRange,
  nextWeek,
  prevWeek,
  startOfWeek,
} from "./calendar-utils";
import { WeekGrid } from "./week-grid";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { useLiveTaskRefresh } from "@/components/tasks/use-live-task-refresh";
import { type Capability } from "@/lib/capabilities";

type Props = {
  initialItems: TaskDTO[];
  initialClients: ClientDTO[];
  initialMembers: MemberDTO[];
  currentUserId: string;
  initialWeekStartIso: string;
  storageEnabled: boolean; // DEV-032: reveal the task files section (edit dialog)
  capabilities: Capability[];
};

export function CalendarPage({
  initialItems,
  initialClients,
  initialMembers,
  currentUserId,
  initialWeekStartIso,
  storageEnabled,
  capabilities,
}: Props) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  const [items, setItems] = useState<TaskDTO[]>(initialItems);
  const [clients] = useState<ClientDTO[]>(initialClients);
  const [members] = useState<MemberDTO[]>(initialMembers);
  const [weekStart, setWeekStart] = useState<Date>(
    () => new Date(initialWeekStartIso),
  );
  const [loading, setLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogTarget, setDialogTarget] = useState<TaskDTO | null>(null);

  const clientNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of clients) m[c.id] = c.name;
    return m;
  }, [clients]);

  const refetch = useCallback(
    async (target: Date) => {
      setLoading(true);
      try {
        const ws = startOfWeek(target);
        const we = endOfWeek(target);
        const query: Partial<ListTasksQuery> = {
          lifecycle: "active",
          dueAfter: ws.toISOString(),
          dueBefore: we.toISOString(),
          limit: 200,
        };
        const result = await apiClient.tasks.list(query);
        setItems(result.items);
      } catch (err) {
        if (err instanceof ApiError) {
          toast.error(t("calendar.loadError", { message: err.message }));
        } else {
          toast.error(t("common.unexpectedError"));
          console.error(err);
        }
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  // Refetch whenever the visible week changes. Skip the very first
  // render — initialItems already cover it.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    void refetch(weekStart);
  }, [weekStart, refetch]);

  // Live refresh: pick up other users' task changes automatically (~3s).
  useLiveTaskRefresh(() => void refetch(weekStart));

  function goPrev() {
    setWeekStart(prevWeek(weekStart));
  }
  function goNext() {
    setWeekStart(nextWeek(weekStart));
  }
  function goToday() {
    setWeekStart(startOfWeek(new Date()));
  }

  function handleTaskClick(task: TaskDTO) {
    setDialogMode("edit");
    setDialogTarget(task);
    setDialogOpen(true);
  }

  function handleCreateClick() {
    setDialogMode("create");
    setDialogTarget(null);
    setDialogOpen(true);
  }

  function handleSaved(saved: TaskDTO) {
    setItems((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      if (idx === -1) return [saved, ...prev];
      const next = prev.slice();
      next[idx] = saved;
      return next;
    });
    void refetch(weekStart);
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {t("calendar.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("calendar.subtitle")}
          </p>
        </div>
        <Button onClick={handleCreateClick}>
          <Plus className="size-4" />
          {t("tasks.newTask")}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goPrev}
            aria-label={t("calendar.prevWeek")}
          >
            {/* Written LTR-first; rtl:rotate-180 keeps the Hebrew arrows
                pointing exactly as before (prev = toward the week start). */}
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            {t("calendar.today")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goNext}
            aria-label={t("calendar.nextWeek")}
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>

        <h2 className="text-lg font-semibold">
          {formatWeekRange(weekStart, localeTag)}
        </h2>

        <div className="flex items-center gap-3 ms-auto">
          {loading && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {t("common.loading")}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {t("calendar.tasksInWeek", { count: items.length })}
          </span>
        </div>
      </div>

      <WeekGrid
        weekStart={weekStart}
        tasks={items}
        clientNameById={clientNameById}
        onTaskClick={handleTaskClick}
      />

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        initial={dialogTarget}
        clients={clients}
        members={members}
        currentUserId={currentUserId}
        defaultWithDueDate
        storageEnabled={storageEnabled}
        capabilities={capabilities}
        onSaved={handleSaved}
      />
    </div>
  );
}
