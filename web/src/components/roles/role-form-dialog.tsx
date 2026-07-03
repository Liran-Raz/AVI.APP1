"use client";

import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  apiClient,
  ApiError,
  type RoleDTO,
  type RoleGrantInput,
} from "@/lib/api-client";
import type { RecordScope } from "@/server/auth/permissions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildCatalog,
  SCOPE_LABELS,
  SUPPORTED_SCOPES,
  type CatalogEntry,
} from "./permission-catalog";

export type RoleDialogMode = "create" | "edit" | "view" | "duplicate";

type GrantState = Map<string, { checked: boolean; scope: RecordScope | null }>;

function initialGrants(role: RoleDTO | null): GrantState {
  const m: GrantState = new Map();
  if (role) {
    for (const g of role.permissions) {
      m.set(g.permissionKey, { checked: true, scope: g.recordScope });
    }
  }
  return m;
}

const TITLES: Record<RoleDialogMode, string> = {
  create: "תפקיד חדש",
  edit: "עריכת תפקיד",
  view: "צפייה בתפקיד",
  duplicate: "שכפול תפקיד",
};

export function RoleFormDialog({
  open,
  mode,
  target,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  mode: RoleDialogMode;
  target: RoleDTO | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Fresh state per open (mode + role).
  const formKey = `${mode}:${target?.id ?? "new"}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <RoleFormBody
          key={formKey}
          mode={mode}
          target={target}
          onCancel={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function RoleFormBody({
  mode,
  target,
  onCancel,
  onSaved,
}: {
  mode: RoleDialogMode;
  target: RoleDTO | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const catalog = useMemo(() => buildCatalog(), []);
  const readOnly = mode === "view";
  const isDuplicate = mode === "duplicate";

  const [name, setName] = useState(() => {
    if (mode === "duplicate") return `עותק של ${target?.name ?? ""}`;
    if (mode === "edit" || mode === "view") return target?.name ?? "";
    return "";
  });
  const [description, setDescription] = useState(() =>
    mode === "edit" || mode === "view" ? (target?.description ?? "") : "",
  );
  const [grants, setGrants] = useState<GrantState>(() =>
    initialGrants(mode === "create" ? null : target),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(entry: CatalogEntry, checked: boolean) {
    setGrants((prev) => {
      const next = new Map(prev);
      if (checked) {
        next.set(entry.key, {
          checked: true,
          scope: entry.scoped ? "all" : null,
        });
      } else {
        next.delete(entry.key);
      }
      return next;
    });
  }

  function setScope(entry: CatalogEntry, scope: RecordScope) {
    setGrants((prev) => {
      const next = new Map(prev);
      const cur = next.get(entry.key);
      if (cur) next.set(entry.key, { ...cur, scope });
      return next;
    });
  }

  function buildPermissions(): RoleGrantInput[] {
    const out: RoleGrantInput[] = [];
    for (const [key, v] of grants) {
      if (!v.checked) continue;
      out.push({ permissionKey: key, recordScope: v.scope });
    }
    return out;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("שם התפקיד הוא שדה חובה");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "create") {
        await apiClient.roles.create({
          name: trimmed,
          description: description.trim() || null,
          permissions: buildPermissions(),
        });
        toast.success("התפקיד נוצר");
      } else if (mode === "edit" && target) {
        await apiClient.roles.update(target.id, {
          name: trimmed,
          description: description.trim() || null,
          permissions: buildPermissions(),
          expectedUpdatedAt: target.updatedAt,
        });
        toast.success("התפקיד עודכן");
      } else if (mode === "duplicate" && target) {
        await apiClient.roles.duplicate(target.id, { name: trimmed });
        toast.success("התפקיד שוכפל");
      }
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "שגיאה לא צפויה";
      setError(msg);
      toast.error(`שגיאה: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
      <DialogHeader>
        <DialogTitle>{TITLES[mode]}</DialogTitle>
        <DialogDescription>
          {isDuplicate
            ? `העתקת ההרשאות מהתפקיד "${target?.name}" לתפקיד חדש.`
            : readOnly
              ? "תפקיד מערכת — לקריאה בלבד."
              : "הגדרת שם, תיאור ומערך ההרשאות של התפקיד."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0">
        <div className="space-y-2">
          <Label htmlFor="role-name">
            שם <span className="text-destructive">*</span>
          </Label>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            disabled={readOnly}
            autoFocus
          />
        </div>

        {!isDuplicate && (
          <div className="space-y-2">
            <Label htmlFor="role-desc">תיאור</Label>
            <Textarea
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              disabled={readOnly}
              rows={2}
            />
          </div>
        )}

        {!isDuplicate && (
          <div className="space-y-3">
            <Label>הרשאות</Label>
            {catalog.map((group) => (
              <div
                key={group.category}
                className="rounded-md border border-border p-3"
              >
                <div className="font-medium text-sm mb-2">{group.label}</div>
                <div className="space-y-2">
                  {group.entries.map((entry) => {
                    const g = grants.get(entry.key);
                    const checked = !!g?.checked;
                    return (
                      <div
                        key={entry.key}
                        className="flex items-center justify-between gap-2"
                      >
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={checked}
                            disabled={readOnly}
                            onCheckedChange={(v) => toggle(entry, v === true)}
                          />
                          {entry.label}
                        </label>
                        {entry.scoped && checked && (
                          <Select
                            value={g?.scope ?? "all"}
                            disabled={readOnly}
                            onValueChange={(v) =>
                              setScope(entry, v as RecordScope)
                            }
                          >
                            <SelectTrigger className="h-8 w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SUPPORTED_SCOPES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {SCOPE_LABELS[s]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          {readOnly ? "סגירה" : "ביטול"}
        </Button>
        {!readOnly && (
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {mode === "create"
              ? "צור תפקיד"
              : mode === "duplicate"
                ? "שכפל"
                : "שמור שינויים"}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
