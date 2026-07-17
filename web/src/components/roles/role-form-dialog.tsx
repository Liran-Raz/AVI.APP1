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
import { useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";
import {
  buildCatalog,
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

const TITLE_KEY: Record<RoleDialogMode, MessageKey> = {
  create: "roles.form.createTitle",
  edit: "roles.form.editTitle",
  view: "roles.form.viewTitle",
  duplicate: "roles.form.duplicateTitle",
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
  const t = useT();
  const catalog = useMemo(() => buildCatalog(), []);
  const readOnly = mode === "view";
  const isDuplicate = mode === "duplicate";

  const [name, setName] = useState(() => {
    if (mode === "duplicate")
      return t("roles.form.copyOfName", { name: target?.name ?? "" });
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
      setError(t("roles.form.nameRequired"));
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
        toast.success(t("roles.form.createdToast"));
      } else if (mode === "edit" && target) {
        await apiClient.roles.update(target.id, {
          name: trimmed,
          description: description.trim() || null,
          permissions: buildPermissions(),
          expectedUpdatedAt: target.updatedAt,
        });
        toast.success(t("roles.form.updatedToast"));
      } else if (mode === "duplicate" && target) {
        await apiClient.roles.duplicate(target.id, { name: trimmed });
        toast.success(t("roles.form.duplicatedToast"));
      }
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("common.unexpectedError");
      setError(msg);
      toast.error(t("roles.errorWithMessage", { message: msg }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
      <DialogHeader>
        <DialogTitle>{t(TITLE_KEY[mode])}</DialogTitle>
        <DialogDescription>
          {isDuplicate
            ? t("roles.form.duplicateDesc", { name: target?.name ?? "" })
            : readOnly
              ? t("roles.form.viewDesc")
              : t("roles.form.desc")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0">
        <div className="space-y-2">
          <Label htmlFor="role-name">
            {t("roles.form.name")} <span className="text-destructive">*</span>
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
            <Label htmlFor="role-desc">{t("roles.form.description")}</Label>
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
            <Label>{t("roles.form.permissions")}</Label>
            {catalog.map((group) => (
              <div
                key={group.category}
                className="rounded-md border border-border p-3"
              >
                <div className="font-medium text-sm mb-2">
                  {t(`permCategory.${group.category}` as MessageKey)}
                </div>
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
                          {`${t(`permCategory.${group.category}` as MessageKey)} — ${t(`permVerb.${entry.verb}` as MessageKey)}`}
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
                                  {t(`permScope.${s}` as MessageKey)}
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
          {readOnly ? t("common.close") : t("common.cancel")}
        </Button>
        {!readOnly && (
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {mode === "create"
              ? t("roles.form.submitCreate")
              : mode === "duplicate"
                ? t("roles.form.submitDuplicate")
                : t("roles.form.submitSave")}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
