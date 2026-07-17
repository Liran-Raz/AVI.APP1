"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  apiClient,
  type GroupSummaryDTO,
  type MemberDTO,
} from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";
import { ResponsiveModal } from "./responsive-modal";
import { MemberMultiSelect, toggleInSet } from "./member-multi-select";

// Create-group dialog: a name + a multi-select of members. The creator is added as
// admin server-side. On success the parent opens the new group.
export function NewGroupDialog({
  open,
  onOpenChange,
  candidates,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: MemberDTO[]; // active members other than me
  onCreated: (group: GroupSummaryDTO) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle("");
    setSelected(new Set());
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function submit() {
    const name = title.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    try {
      const group = await apiClient.conversations.create({
        title: name,
        memberIds: [...selected],
      });
      toast.success(t("messages.newGroup.createdToast"));
      reset();
      onOpenChange(false);
      onCreated(group);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("messages.newGroup.createFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={handleOpenChange}
      title={t("messages.newGroup.title")}
      icon={<UsersRound className="size-5 text-primary" />}
      dismissible={!submitting}
      footer={
        <div className="flex gap-2">
          <Button
            onClick={() => void submit()}
            disabled={submitting || title.trim().length === 0}
            className="gap-2"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("messages.newGroup.submit")}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <label
        htmlFor="new-group-name"
        className="mb-1.5 block text-xs font-semibold text-muted-foreground"
      >
        {t("messages.group.nameLabel")}
      </label>
      <Input
        id="new-group-name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={80}
        placeholder={t("messages.newGroup.namePlaceholder")}
        autoFocus
      />

      <div className="mt-4 mb-1.5 text-xs font-semibold text-muted-foreground">
        {t("messages.group.addMembers")}
      </div>
      <MemberMultiSelect
        members={candidates}
        selected={selected}
        onToggle={(id) => toggleInSet(setSelected, id)}
        emptyLabel={t("messages.newGroup.noCandidates")}
      />
      <p className="mt-2 mb-1 text-xs text-muted-foreground">
        {t("messages.newGroup.selectedAdminHint", { count: selected.size })}
      </p>
    </ResponsiveModal>
  );
}
