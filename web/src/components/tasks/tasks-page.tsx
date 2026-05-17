"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ListChecks,
  Loader2,
  Plus,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApiError,
  apiClient,
  LIFECYCLE_FILTERS,
  TASK_PRIORITIES,
  type ClientDTO,
  type LifecycleFilter,
  type ListTasksQuery,
  type TaskDTO,
  type TaskPriorityValue,
} from "@/lib/api-client";

import { TaskCard } from "./task-card";
import { TaskFormDialog } from "./task-form-dialog";
import {
  KANBAN_COLUMNS,
  LIFECYCLE_LABELS,
  PRIORITY_LABELS,
  kanbanColumnForStatus,
} from "./task-utils";

const SEARCH_DEBOUNCE_MS = 300;
const PRIORITY_FILTER_ALL = "__all__";

type Props = {
  initialItems: TaskDTO[];
  initialClients: ClientDTO[]; // for picker + name lookup
};

export function TasksPage({ initialItems, initialClients }: Props) {
  const [items, setItems] = useState<TaskDTO[]>(initialItems);
  const [clients] = useState<ClientDTO[]>(initialClients);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("active");
  const [priorityFilter, setPriorityFilter] = useState<string>(
    PRIORITY_FILTER_ALL,
  );
  const [loading, setLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogTarget, setDialogTarget] = useState<TaskDTO | null>(null);

  // O(1) client name lookup by id for cards
  const clientNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of clients) m[c.id] = c.name;
    return m;
  }, [clients]);

  // Debounce search input -> debouncedSearch
  useEffect(() => {
    const t = setTimeout(
      () => setDebouncedSearch(searchInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [searchInput]);

  const isFirstRun = useRef(true);
  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const query: Partial<ListTasksQuery> = {
        lifecycle,
        priority:
          priorityFilter === PRIORITY_FILTER_ALL
            ? undefined
            : (priorityFilter as TaskPriorityValue),
        search: debouncedSearch || undefined,
      };
      const result = await apiClient.tasks.list(query);
      setItems(result.items);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(`שגיאה בטעינת משימות: ${err.message}`);
      } else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }, [lifecycle, priorityFilter, debouncedSearch]);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    void refetch();
  }, [refetch]);

  function handleCreateClick() {
    setDialogMode("create");
    setDialogTarget(null);
    setDialogOpen(true);
  }

  function handleEdit(task: TaskDTO) {
    setDialogMode("edit");
    setDialogTarget(task);
    setDialogOpen(true);
  }

  async function handleAdvance(task: TaskDTO) {
    // Move to next status (new -> received -> in_progress -> done)
    let nextStatus: TaskDTO["status"] | null;
    switch (task.status) {
      case "new":
        nextStatus = "received";
        break;
      case "received":
        nextStatus = "in_progress";
        break;
      case "in_progress":
        nextStatus = "done";
        break;
      default:
        nextStatus = null;
    }
    if (!nextStatus) return;
    try {
      await apiClient.tasks.setStatus(task.id, { status: nextStatus });
      toast.success("סטטוס עודכן");
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    }
  }

  async function handleArchive(task: TaskDTO) {
    try {
      await apiClient.tasks.archive(task.id);
      toast.success("הועבר לארכיון");
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    }
  }

  async function handleUnarchive(task: TaskDTO) {
    try {
      await apiClient.tasks.unarchive(task.id);
      toast.success("הוחזר מהארכיון");
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    }
  }

  async function handleDelete(task: TaskDTO) {
    if (!window.confirm(`להעביר את "${task.title}" לפח?`)) return;
    try {
      await apiClient.tasks.delete(task.id);
      toast.success("הועבר לפח");
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    }
  }

  async function handleRestore(task: TaskDTO) {
    try {
      await apiClient.tasks.restore(task.id);
      toast.success("שוחזר מהפח");
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    }
  }

  function handleSaved(saved: TaskDTO) {
    setItems((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      if (idx === -1) return [saved, ...prev];
      const next = prev.slice();
      next[idx] = saved;
      return next;
    });
    void refetch();
  }

  // Group items by Kanban column (only meaningful when lifecycle === 'active')
  const grouped = useMemo(() => {
    const byCol: Record<string, TaskDTO[]> = {
      todo: [],
      in_progress: [],
      done: [],
    };
    for (const t of items) {
      const col = kanbanColumnForStatus(t.status);
      byCol[col].push(t);
    }
    return byCol;
  }, [items]);

  const sharedCardHandlers = {
    onEdit: handleEdit,
    onAdvance: handleAdvance,
    onArchive: handleArchive,
    onUnarchive: handleUnarchive,
    onDelete: handleDelete,
    onRestore: handleRestore,
  };

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            תור משימות
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            לביצוע, בתהליך והושלם — ממוין לפי תאריך יעד
          </p>
        </div>
        <Button onClick={handleCreateClick}>
          <Plus className="size-4" />
          משימה חדשה
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="חיפוש לפי כותרת או תיאור"
            className="pr-9"
            maxLength={100}
          />
        </div>

        <Select
          value={priorityFilter}
          onValueChange={setPriorityFilter}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PRIORITY_FILTER_ALL}>כל העדיפויות</SelectItem>
            {TASK_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={lifecycle}
          onValueChange={(v) => setLifecycle(v as LifecycleFilter)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIFECYCLE_FILTERS.map((lf) => (
              <SelectItem key={lf} value={lf}>
                {LIFECYCLE_LABELS[lf]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {loading && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            טוען...
          </div>
        )}

        <div className="text-xs text-muted-foreground mr-auto">
          {items.length} משימות
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          hasFilters={
            debouncedSearch.length > 0 ||
            priorityFilter !== PRIORITY_FILTER_ALL ||
            lifecycle !== "active"
          }
          onAddTask={handleCreateClick}
        />
      ) : lifecycle === "active" ? (
        <KanbanView
          grouped={grouped}
          clientNameById={clientNameById}
          handlers={sharedCardHandlers}
        />
      ) : (
        <FlatListView
          items={items}
          clientNameById={clientNameById}
          handlers={sharedCardHandlers}
        />
      )}

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        initial={dialogTarget}
        clients={clients}
        onSaved={handleSaved}
      />
    </div>
  );
}

// ============================================================
// Kanban view (3 columns for active lifecycle)
// ============================================================

type CardHandlers = {
  onEdit: (t: TaskDTO) => void;
  onAdvance: (t: TaskDTO) => void;
  onArchive: (t: TaskDTO) => void;
  onUnarchive: (t: TaskDTO) => void;
  onDelete: (t: TaskDTO) => void;
  onRestore: (t: TaskDTO) => void;
};

function KanbanView({
  grouped,
  clientNameById,
  handlers,
}: {
  grouped: Record<string, TaskDTO[]>;
  clientNameById: Record<string, string>;
  handlers: CardHandlers;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {KANBAN_COLUMNS.map((col) => {
        const colItems = grouped[col.key] ?? [];
        return (
          <div
            key={col.key}
            className="rounded-lg border border-border bg-card/50 p-3 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">{col.label}</h2>
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {colItems.length}
              </span>
            </div>
            <div className="space-y-2 min-h-[60px]">
              {colItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  אין משימות
                </p>
              ) : (
                colItems.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    clientName={
                      task.clientId ? clientNameById[task.clientId] ?? null : null
                    }
                    {...handlers}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Flat list view (archived / deleted / all)
// ============================================================

function FlatListView({
  items,
  clientNameById,
  handlers,
}: {
  items: TaskDTO[];
  clientNameById: Record<string, string>;
  handlers: CardHandlers;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          clientName={
            task.clientId ? clientNameById[task.clientId] ?? null : null
          }
          {...handlers}
        />
      ))}
    </div>
  );
}

// ============================================================
// Empty states
// ============================================================

function EmptyState({
  hasFilters,
  onAddTask,
}: {
  hasFilters: boolean;
  onAddTask: () => void;
}) {
  if (hasFilters) {
    return (
      <div className="border border-border rounded-lg bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          אין משימות התואמות לסינון.
        </p>
      </div>
    );
  }
  return (
    <div className="border border-dashed border-border rounded-lg bg-card p-12 text-center">
      <div className="size-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <ListChecks className="size-6" />
      </div>
      <h2 className="font-semibold text-lg mb-2">עוד אין משימות בתור</h2>
      <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
        צור את המשימה הראשונה — תיכנס לעמודה &quot;לביצוע&quot;.
      </p>
      <Button onClick={onAddTask}>
        <Plus className="size-4" />
        משימה ראשונה
      </Button>
    </div>
  );
}
