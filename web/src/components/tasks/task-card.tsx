"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarClock,
  MoreHorizontal,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ClientDTO, TaskDTO } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  dueState,
  formatDueAt,
  nextStatus,
} from "./task-utils";

type Props = {
  task: TaskDTO;
  clientName: string | null; // resolved from clientId by parent
  onEdit: (task: TaskDTO) => void;
  onAdvance: (task: TaskDTO) => void; // next-status click
  onArchive: (task: TaskDTO) => void;
  onUnarchive: (task: TaskDTO) => void;
  onDelete: (task: TaskDTO) => void;
  onRestore: (task: TaskDTO) => void;
};

const PRIORITY_CLASS: Record<TaskDTO["priority"], string> = {
  urgent:
    "bg-[var(--priority-urgent)]/10 text-[var(--priority-urgent)] border-[var(--priority-urgent)]/20",
  normal:
    "bg-muted text-muted-foreground border-border",
  optional:
    "bg-[var(--priority-optional)]/10 text-[var(--priority-optional)] border-[var(--priority-optional)]/20",
};

const DUE_CLASS: Record<ReturnType<typeof dueState>, string> = {
  overdue: "text-destructive",
  today: "text-[var(--priority-urgent)]",
  soon: "text-foreground",
  later: "text-muted-foreground",
};

export function TaskCard({
  task,
  clientName,
  onEdit,
  onAdvance,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
}: Props) {
  const next = nextStatus(task.status);
  const isArchived = task.archivedAt !== null;
  const isDeleted = task.deletedAt !== null;
  const due = dueState(task.dueAt);

  return (
    <div className="group rounded-lg border border-border glass-card shadow-card p-3 space-y-2 hover:shadow-overlay transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <Badge
          variant="outline"
          className={cn("text-xs font-medium px-2 py-0.5", PRIORITY_CLASS[task.priority])}
        >
          {PRIORITY_LABELS[task.priority]}
        </Badge>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-60 group-hover:opacity-100"
              aria-label={`פעולות עבור ${task.title}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onEdit(task)}>
              <Pencil className="size-4" />
              ערוך
            </DropdownMenuItem>
            {next && !isDeleted && !isArchived && (
              <DropdownMenuItem onClick={() => onAdvance(task)}>
                <ArrowLeft className="size-4" />
                העבר ל-{STATUS_LABELS[next]}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {!isDeleted && !isArchived && (
              <DropdownMenuItem onClick={() => onArchive(task)}>
                <Archive className="size-4" />
                העבר לארכיון
              </DropdownMenuItem>
            )}
            {isArchived && !isDeleted && (
              <DropdownMenuItem onClick={() => onUnarchive(task)}>
                <ArchiveRestore className="size-4" />
                החזר מארכיון
              </DropdownMenuItem>
            )}
            {!isDeleted && (
              <DropdownMenuItem
                onClick={() => onDelete(task)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" />
                מחק (לפח)
              </DropdownMenuItem>
            )}
            {isDeleted && (
              <DropdownMenuItem onClick={() => onRestore(task)}>
                <Undo2 className="size-4" />
                שחזר מהפח
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="space-y-1">
        <h3 className="font-semibold text-sm leading-tight">{task.title}</h3>
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {task.description}
          </p>
        )}
      </div>

      {clientName && (
        <p className="text-xs text-muted-foreground truncate">
          לקוח: <span className="text-foreground">{clientName}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div
          className={cn(
            "inline-flex items-center gap-1 text-xs",
            DUE_CLASS[due],
          )}
        >
          <CalendarClock className="size-3" />
          {formatDueAt(task.dueAt)}
        </div>
        {isArchived && (
          <Badge variant="outline" className="text-[10px] uppercase">
            ארכיון
          </Badge>
        )}
        {isDeleted && (
          <Badge variant="outline" className="text-[10px] uppercase text-destructive">
            בפח
          </Badge>
        )}
      </div>
    </div>
  );
}

// Helper type for parent components — a quick lookup map from clientId
// to its DTO so the card can show client name without re-fetching.
export type ClientLookup = Record<string, ClientDTO>;
