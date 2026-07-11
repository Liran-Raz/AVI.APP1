"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  apiClient,
  TASK_PRIORITIES,
  type ClientDTO,
  type CreateTaskPayload,
  type MemberDTO,
  type TaskDTO,
  type UpdateTaskPayload,
} from "@/lib/api-client";

import {
  PRIORITY_LABELS,
  defaultDueAtLocal,
  isoToLocalDatetime,
  localDatetimeToISO,
} from "./task-utils";

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  initial: TaskDTO | null;
  clients: ClientDTO[]; // for the client picker
  members: MemberDTO[]; // for the "assignee" picker
  currentUserId: string; // default assignee on create
  // When opened from the calendar, default the due-date checkbox ON (a task
  // with no due date wouldn't appear on the calendar).
  defaultWithDueDate?: boolean;
  onSaved: (saved: TaskDTO) => void;
};

const NONE = "__none__"; // Radix Select doesn't allow empty string

type FormState = {
  title: string;
  description: string;
  hasDueDate: boolean;
  dueAtLocal: string; // datetime-local format
  priority: TaskDTO["priority"];
  assignedTo: string; // a member UUID (mandatory)
  clientId: string; // NONE or a UUID
};

function emptyState(
  currentUserId: string,
  defaultWithDueDate: boolean,
): FormState {
  return {
    title: "",
    description: "",
    hasDueDate: defaultWithDueDate,
    dueAtLocal: defaultDueAtLocal(),
    priority: "normal",
    assignedTo: currentUserId,
    clientId: NONE,
  };
}

function stateFromTask(t: TaskDTO, currentUserId: string): FormState {
  return {
    title: t.title,
    description: t.description ?? "",
    hasDueDate: t.dueAt !== null,
    dueAtLocal: t.dueAt ? isoToLocalDatetime(t.dueAt) : defaultDueAtLocal(),
    priority: t.priority,
    assignedTo: t.assignedTo ?? currentUserId,
    clientId: t.clientId ?? NONE,
  };
}

export function TaskFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  clients,
  members,
  currentUserId,
  defaultWithDueDate = false,
  onSaved,
}: Props) {
  const formKey = mode === "edit" ? (initial?.id ?? "edit") : "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "משימה חדשה" : "עריכת משימה"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "הוספת משימה חדשה לתור."
              : "עדכון פרטי המשימה."}
          </DialogDescription>
        </DialogHeader>

        <TaskFormBody
          key={formKey}
          mode={mode}
          initial={initial}
          clients={clients}
          members={members}
          currentUserId={currentUserId}
          defaultWithDueDate={defaultWithDueDate}
          onCancel={() => onOpenChange(false)}
          onSaved={(saved) => {
            onSaved(saved);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function TaskFormBody({
  mode,
  initial,
  clients,
  members,
  currentUserId,
  defaultWithDueDate,
  onCancel,
  onSaved,
}: {
  mode: Mode;
  initial: TaskDTO | null;
  clients: ClientDTO[];
  members: MemberDTO[];
  currentUserId: string;
  defaultWithDueDate: boolean;
  onCancel: () => void;
  onSaved: (saved: TaskDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && initial
      ? stateFromTask(initial, currentUserId)
      : emptyState(currentUserId, defaultWithDueDate),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Active members, plus the currently-selected one even if it went inactive
  // (so editing a task assigned to a deactivated member still shows a name).
  const assigneeOptions = members.filter(
    (m) => m.isActive || m.id === form.assignedTo,
  );

  function buildCreatePayload(): CreateTaskPayload {
    return {
      title: form.title.trim(),
      description: form.description.trim() || null,
      dueAt: form.hasDueDate ? localDatetimeToISO(form.dueAtLocal) : null,
      priority: form.priority,
      assignedTo: form.assignedTo,
      clientId: form.clientId === NONE ? null : form.clientId,
    };
  }

  function buildUpdatePayload(): UpdateTaskPayload {
    return {
      title: form.title.trim(),
      description: form.description.trim() || null,
      dueAt: form.hasDueDate ? localDatetimeToISO(form.dueAtLocal) : null,
      priority: form.priority,
      assignedTo: form.assignedTo,
      clientId: form.clientId === NONE ? null : form.clientId,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("כותרת המשימה היא שדה חובה");
      return;
    }
    if (!form.assignedTo) {
      setError("יש לבחור איש צוות לביצוע");
      return;
    }
    if (form.hasDueDate && !form.dueAtLocal) {
      setError("יש לבחור תאריך יעד או לבטל את הסימון");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const saved =
        mode === "create"
          ? await apiClient.tasks.create(buildCreatePayload())
          : await apiClient.tasks.update(initial!.id, buildUpdatePayload());
      toast.success(mode === "create" ? "משימה נוצרה" : "משימה עודכנה");
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        toast.error(`שגיאה: ${err.message}`);
      } else {
        setError("שגיאה לא צפויה");
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
    >
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="task-title">
          כותרת <span className="text-destructive">*</span>
        </Label>
        <Input
          id="task-title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="task-description">תיאור</Label>
        <Textarea
          id="task-description"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          maxLength={5000}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-priority">עדיפות</Label>
        <Select
          value={form.priority}
          onValueChange={(v) => set("priority", v as TaskDTO["priority"])}
        >
          <SelectTrigger id="task-priority" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-assignee">
          איש צוות לביצוע <span className="text-destructive">*</span>
        </Label>
        <Select
          value={form.assignedTo}
          onValueChange={(v) => set("assignedTo", v)}
        >
          <SelectTrigger id="task-assignee" className="w-full">
            <SelectValue placeholder="בחר איש צוות" />
          </SelectTrigger>
          <SelectContent>
            {assigneeOptions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.fullName}
                {m.id === currentUserId ? " (אני)" : ""}
                {!m.isActive ? " (לא פעיל)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="task-client">לקוח (אופציונלי)</Label>
        <Select
          value={form.clientId}
          onValueChange={(v) => set("clientId", v)}
        >
          <SelectTrigger id="task-client" className="w-full">
            <SelectValue placeholder="בחר לקוח" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>ללא לקוח</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 sm:col-span-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="task-has-due"
            checked={form.hasDueDate}
            onCheckedChange={(c) => set("hasDueDate", c === true)}
          />
          <Label htmlFor="task-has-due" className="cursor-pointer">
            האם להוסיף תאריך יעד?
          </Label>
        </div>
        {form.hasDueDate && (
          <Input
            id="task-due"
            type="datetime-local"
            value={form.dueAtLocal}
            onChange={(e) => set("dueAtLocal", e.target.value)}
            aria-label="תאריך יעד"
          />
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive sm:col-span-2">{error}</p>
      )}

      <DialogFooter className="sm:col-span-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          ביטול
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {mode === "create" ? "צור משימה" : "שמור שינויים"}
        </Button>
      </DialogFooter>
    </form>
  );
}
