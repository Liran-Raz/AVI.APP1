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
import { FormError } from "@/components/ui/form-error";
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
import { type Capability } from "@/lib/capabilities";
import { TaskFilesSection } from "@/components/storage/task-files-section";
import { useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";

import {
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
  // DEV-032: when STORAGE_UI is on, the EDIT dialog gains a "קבצים" section.
  // Off => the dialog is byte-for-byte unchanged.
  storageEnabled?: boolean;
  capabilities?: Capability[];
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
  storageEnabled = false,
  capabilities = [],
  onSaved,
}: Props) {
  const t = useT();
  const formKey = mode === "edit" ? (initial?.id ?? "edit") : "create";

  // Files attach to an EXISTING task, so the section shows in edit mode only.
  const showFiles = storageEnabled && mode === "edit" && initial !== null;
  const clientName =
    initial?.clientId
      ? (clients.find((c) => c.id === initial.clientId)?.name ?? null)
      : null;
  const nameFor = (userId: string | null) =>
    userId ? (members.find((m) => m.id === userId)?.fullName ?? null) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("tasks.newTask") : t("tasks.form.editTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? t("tasks.form.createDesc")
              : t("tasks.form.editDesc")}
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

        {showFiles && initial && (
          <div className="border-t border-border pt-4 mt-1">
            <TaskFilesSection
              taskId={initial.id}
              clientName={clientName}
              capabilities={capabilities}
              nameFor={nameFor}
            />
          </div>
        )}
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
  const t = useT();
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && initial
      ? stateFromTask(initial, currentUserId)
      : emptyState(currentUserId, defaultWithDueDate),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (error) setError(null);
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
      setError(t("tasks.form.titleRequired"));
      return;
    }
    if (!form.assignedTo) {
      setError(t("tasks.form.assigneeRequired"));
      return;
    }
    if (form.hasDueDate && !form.dueAtLocal) {
      setError(t("tasks.form.dueDateRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const saved =
        mode === "create"
          ? await apiClient.tasks.create(buildCreatePayload())
          : await apiClient.tasks.update(initial!.id, buildUpdatePayload());
      toast.success(
        mode === "create"
          ? t("tasks.form.createdToast")
          : t("tasks.form.updatedToast"),
      );
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        toast.error(t("tasks.errorWithMessage", { message: err.message }));
      } else {
        setError(t("common.unexpectedError"));
        toast.error(t("common.unexpectedError"));
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
          {t("tasks.form.titleLabel")}{" "}
          <span className="text-destructive">*</span>
        </Label>
        <Input
          id="task-title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={200}
          required
          autoFocus
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "task-error" : undefined}
        />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="task-description">
          {t("tasks.form.descriptionLabel")}
        </Label>
        <Textarea
          id="task-description"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          maxLength={5000}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-priority">{t("tasks.form.priorityLabel")}</Label>
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
                {t(`taskPriority.${p}` as MessageKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-assignee">
          {t("tasks.form.assigneeLabel")}{" "}
          <span className="text-destructive">*</span>
        </Label>
        <Select
          value={form.assignedTo}
          onValueChange={(v) => set("assignedTo", v)}
        >
          <SelectTrigger id="task-assignee" className="w-full">
            <SelectValue placeholder={t("tasks.form.assigneePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {assigneeOptions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.fullName}
                {m.id === currentUserId ? t("tasks.form.assigneeMe") : ""}
                {!m.isActive ? t("tasks.form.assigneeInactive") : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="task-client">{t("tasks.form.clientLabel")}</Label>
        <Select
          value={form.clientId}
          onValueChange={(v) => set("clientId", v)}
        >
          <SelectTrigger id="task-client" className="w-full">
            <SelectValue placeholder={t("tasks.form.clientPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("tasks.form.noClient")}</SelectItem>
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
            {t("tasks.form.addDueDate")}
          </Label>
        </div>
        {form.hasDueDate && (
          <Input
            id="task-due"
            type="datetime-local"
            value={form.dueAtLocal}
            onChange={(e) => set("dueAtLocal", e.target.value)}
            aria-label={t("tasks.form.dueDateAria")}
          />
        )}
      </div>

      <FormError id="task-error" message={error} className="sm:col-span-2" />

      <DialogFooter className="sm:col-span-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {mode === "create" ? t("tasks.form.submitCreate") : t("tasks.form.submitSave")}
        </Button>
      </DialogFooter>
    </form>
  );
}
