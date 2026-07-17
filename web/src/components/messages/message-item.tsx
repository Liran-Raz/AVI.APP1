"use client";

import { useState } from "react";
import { Check, CheckCheck, Loader2, Pencil, Trash2 } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/i18n/locale-provider";
import { dirFor } from "@/i18n/config";
import type { MessageDTO, ReadRecipientDTO } from "@/lib/api-client";

const EDIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes (matches the DB policy)

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

// One chat message. Others' messages are plain bubbles; MY messages carry read
// ticks (✓ sent / ✓✓ read-by-all) and open a unified panel on click — "read by"
// (per recipient) + edit/delete while inside the 10-minute window. Deleted
// messages render as a tombstone (no panel).
export function MessageItem({
  message,
  mine,
  showSenderName,
  readByAll,
  recipients,
  onEdit,
  onDelete,
}: {
  message: MessageDTO;
  mine: boolean;
  showSenderName: boolean;
  readByAll: boolean;
  recipients: ReadRecipientDTO[];
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const t = useT();
  const dir = dirFor(useLocale());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [busy, setBusy] = useState(false);
  // Whether edit/delete are still allowed — computed when the panel OPENS (Date.now()
  // is impure and must not run during render). The DB is authoritative regardless.
  const [canManage, setCanManage] = useState(false);

  const deleted = message.deletedAt != null;

  const bubbleClass = cn(
    "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-card",
    mine
      ? "rounded-ee-sm bg-primary text-primary-foreground"
      : "glass-card rounded-es-sm border border-border",
  );

  // ----- deleted tombstone -----
  if (deleted) {
    return (
      <div className={cn("flex", mine ? "justify-start" : "justify-end")}>
        <div
          className={cn(
            "flex max-w-[78%] items-center gap-1.5 rounded-2xl border border-dashed border-border bg-muted/30 px-3 py-2 text-sm italic text-muted-foreground",
            mine ? "rounded-ee-sm" : "rounded-es-sm",
          )}
        >
          <Trash2 className="size-3.5 opacity-70" />
          {t("messages.item.deleted")}
        </div>
      </div>
    );
  }

  // ----- inline edit mode (my message) -----
  if (editing) {
    return (
      <div className="flex justify-start">
        <div className={cn(bubbleClass, "w-[78%]")}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            autoFocus
            className="w-full resize-none rounded-lg border-none bg-white/15 px-2 py-1 text-sm text-white outline-none placeholder:text-white/60 focus:ring-2 focus:ring-white/40"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(message.body);
              }}
              disabled={busy}
              className="rounded-md px-2 py-1 text-xs font-medium text-white/85 hover:bg-white/15"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={busy || draft.trim().length === 0}
              onClick={async () => {
                const next = draft.trim();
                if (!next || next === message.body) {
                  setEditing(false);
                  return;
                }
                setBusy(true);
                try {
                  await onEdit(message.id, next);
                  setEditing(false);
                } catch {
                  // onEdit already surfaced the error; keep the editor open + the draft.
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex items-center gap-1 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/30 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : null}
              {t("messages.item.save")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const bubbleInner = (
    <div className={bubbleClass}>
      {showSenderName ? (
        <div className="mb-0.5 text-[11px] font-semibold opacity-80">
          {message.senderName}
        </div>
      ) : null}
      <div className="break-words whitespace-pre-wrap">{message.body}</div>
      <div
        className={cn(
          "mt-1 flex items-center gap-1 text-[10px]",
          mine ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
        dir="ltr"
      >
        {message.editedAt ? (
          <span className="italic">{t("messages.item.edited")}</span>
        ) : null}
        {message.editedAt ? <span>·</span> : null}
        <span>{fmtTime(message.createdAt)}</span>
        {mine ? (
          readByAll ? (
            <CheckCheck className="size-3.5 text-[#bfe0ff]" />
          ) : (
            <Check className="size-3.5 text-primary-foreground/70" />
          )
        ) : null}
      </div>
    </div>
  );

  // Others' messages: plain bubble (no panel).
  if (!mine) {
    return <div className="flex justify-end">{bubbleInner}</div>;
  }

  // My message: click opens the unified panel (read-by + actions).
  return (
    <div className="flex justify-start">
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (o) {
            setCanManage(
              Date.now() - Date.parse(message.createdAt) < EDIT_WINDOW_MS,
            );
          }
          setOpen(o);
        }}
      >
        <PopoverTrigger asChild>
          <button type="button" className="max-w-full text-start">
            {bubbleInner}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 overflow-hidden p-0"
          dir={dir}
        >
          <div className="border-b border-border px-3 py-2 text-xs font-bold text-muted-foreground">
            {t("messages.item.readBy")}{" "}
            {recipients.length > 0
              ? `(${recipients.filter((r) => isRead(r, message.createdAt)).length}/${recipients.length})`
              : ""}
          </div>
          <div className="max-h-56 overflow-y-auto">
            {recipients.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                {t("messages.item.noRecipients")}
              </p>
            ) : (
              recipients.map((r) => {
                const read = isRead(r, message.createdAt);
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      {initials(r.name)}
                    </span>
                    <span className="flex-1 truncate text-[13px] font-medium">
                      {r.name}
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-semibold",
                        read ? "text-[#2563eb]" : "text-muted-foreground",
                      )}
                    >
                      {read && r.lastReadAt
                        ? `✓ ${fmtTime(r.lastReadAt)}`
                        : t("messages.item.notYet")}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          {canManage ? (
            <div className="flex border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setDraft(message.body);
                  setEditing(true);
                }}
                className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[13px] font-semibold text-primary hover:bg-primary/5"
              >
                <Pencil className="size-4" />
                {t("messages.item.edit")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(t("messages.item.confirmDelete"))) return;
                  setBusy(true);
                  try {
                    await onDelete(message.id);
                    setOpen(false);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex flex-1 items-center justify-center gap-1.5 border-s border-border py-2.5 text-[13px] font-semibold text-destructive hover:bg-destructive/5"
              >
                <Trash2 className="size-4" />
                {t("messages.item.delete")}
              </button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function isRead(r: ReadRecipientDTO, messageCreatedAt: string): boolean {
  return (
    r.lastReadAt != null &&
    Date.parse(r.lastReadAt) >= Date.parse(messageCreatedAt)
  );
}
