"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  apiClient,
  type GroupDetailDTO,
  type MemberDTO,
} from "@/lib/api-client";
import { ResponsiveModal } from "./responsive-modal";
import { MemberMultiSelect, toggleInSet } from "./member-multi-select";

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

// Group info + management. Admins can rename, add/remove members, and delete;
// anyone can leave. All authorization is enforced server-side (RPCs); the UI only
// hides the controls a non-admin can't use.
export function GroupManageDialog({
  open,
  onOpenChange,
  conversationId,
  roster,
  currentUserId,
  onChanged,
  onLeftOrDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
  roster: MemberDTO[]; // full org roster (for add candidates)
  currentUserId: string;
  onChanged: (detail: GroupDetailDTO) => void; // title/members changed
  onLeftOrDeleted: () => void; // I left, or the group was deleted
}) {
  const [detail, setDetail] = useState<GroupDetailDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"view" | "add">("view");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());

  // Load fresh detail each time the dialog opens for a conversation.
  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setMode("view");
      setEditingName(false);
      setAddSelected(new Set());
      try {
        const d = await apiClient.conversations.get(conversationId);
        if (!cancelled) setDetail(d);
      } catch (err) {
        if (cancelled) return;
        toast.error(
          err instanceof ApiError ? err.message : "טעינת הקבוצה נכשלה",
        );
        onOpenChange(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // onOpenChange is stable from the parent; re-running only on open/id is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId]);

  const isAdmin = detail?.isAdmin ?? false;

  function applyDetail(d: GroupDetailDTO) {
    setDetail(d);
    onChanged(d);
  }

  async function saveRename() {
    if (!detail || busy) return;
    const name = nameDraft.trim();
    if (!name) return;
    if (name === detail.title) {
      setEditingName(false);
      return;
    }
    setBusy(true);
    try {
      const d = await apiClient.conversations.rename(detail.id, { title: name });
      applyDetail(d);
      setEditingName(false);
      toast.success("שם הקבוצה עודכן");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "עדכון השם נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(userId: string) {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const d = await apiClient.conversations.removeMember(detail.id, userId);
      applyDetail(d);
      toast.success("החבר הוסר מהקבוצה");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "הסרת החבר נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAdd() {
    if (!detail || busy || addSelected.size === 0) return;
    setBusy(true);
    // Add sequentially; each call returns the updated detail. Track the latest so that
    // even a mid-loop failure reflects whoever DID get added (a partial success is real).
    let latest = detail;
    let added = 0;
    try {
      for (const uid of addSelected) {
        latest = await apiClient.conversations.addMember(detail.id, {
          userId: uid,
        });
        added++;
      }
      setAddSelected(new Set());
      setMode("view");
      toast.success("החברים נוספו");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "הוספת החברים נכשלה");
    } finally {
      if (added > 0) applyDetail(latest); // reflect the members that actually joined
      setBusy(false);
    }
  }

  async function leave() {
    if (!detail || busy) return;
    if (!window.confirm(`לעזוב את הקבוצה "${detail.title}"?`)) return;
    setBusy(true);
    try {
      await apiClient.conversations.leave(detail.id);
      toast.success("עזבת את הקבוצה");
      onOpenChange(false);
      onLeftOrDeleted();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "עזיבת הקבוצה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup() {
    if (!detail || busy) return;
    if (
      !window.confirm(
        `למחוק את הקבוצה "${detail.title}" לכל החברים? פעולה זו אינה הפיכה.`,
      )
    )
      return;
    setBusy(true);
    try {
      await apiClient.conversations.remove(detail.id);
      toast.success("הקבוצה נמחקה");
      onOpenChange(false);
      onLeftOrDeleted();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "מחיקת הקבוצה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const candidates = roster.filter(
    (m) => m.isActive && !detail?.members.some((x) => x.id === m.id),
  );

  const title = mode === "add" ? "הוספת חברים" : "פרטי הקבוצה";

  const footer =
    loading || !detail ? null : mode === "add" ? (
      <div className="flex gap-2">
        <Button
          onClick={() => void confirmAdd()}
          disabled={busy || addSelected.size === 0}
          className="gap-2"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          הוסף {addSelected.size > 0 ? `(${addSelected.size})` : ""}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setMode("view");
            setAddSelected(new Set());
          }}
          disabled={busy}
        >
          חזרה
        </Button>
      </div>
    ) : (
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={() => void leave()}
          disabled={busy}
          className="gap-2"
        >
          <LogOut className="size-4" />
          עזוב קבוצה
        </Button>
        {isAdmin ? (
          <Button
            variant="ghost"
            onClick={() => void removeGroup()}
            disabled={busy}
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" />
            מחק
          </Button>
        ) : null}
      </div>
    );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o);
      }}
      title={title}
      icon={<UsersRound className="size-5 text-primary" />}
      dismissible={!busy}
      footer={footer}
    >
      {loading || !detail ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : mode === "add" ? (
        <>
          <MemberMultiSelect
            members={candidates}
            selected={addSelected}
            onToggle={(id) => toggleInSet(setAddSelected, id)}
            emptyLabel="כל חברי הצוות כבר בקבוצה."
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {addSelected.size} נבחרו
          </p>
        </>
      ) : (
        <>
          <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
            שם הקבוצה
          </div>
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={80}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveRename();
                  }
                }}
              />
              <Button
                size="icon"
                onClick={() => void saveRename()}
                disabled={busy}
                aria-label="שמור שם"
              >
                <Check className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setEditingName(false)}
                disabled={busy}
                aria-label="ביטול"
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-base font-bold">{detail.title}</span>
              {isAdmin ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => {
                    setNameDraft(detail.title);
                    setEditingName(true);
                  }}
                  aria-label="שנה שם"
                >
                  <Pencil className="size-4" />
                </Button>
              ) : null}
            </div>
          )}

          <div className="my-4 border-t border-border" />

          <div className="mb-2 text-xs font-semibold text-muted-foreground">
            חברים ({detail.members.length})
          </div>
          <div className="space-y-0.5">
            {detail.members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                    {initials(m.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {m.name}
                    {m.id === currentUserId ? " (אתה)" : ""}
                  </span>
                </span>
                {m.isAdmin ? (
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    מנהל
                  </span>
                ) : null}
                {isAdmin && m.id !== currentUserId ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => void removeOne(m.id)}
                    disabled={busy}
                    aria-label={`הסר את ${m.name}`}
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          {isAdmin ? (
            <Button
              variant="outline"
              className="mt-3 w-full gap-2 border-dashed"
              onClick={() => setMode("add")}
              disabled={busy}
            >
              <Plus className="size-4" />
              הוסף חברים
            </Button>
          ) : (
            <p className="mt-3 rounded-lg border border-primary/15 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
              ניהול החברים והשם שמורים למנהל הקבוצה. אתה יכול לעזוב את הקבוצה בכל
              עת.
            </p>
          )}
        </>
      )}
    </ResponsiveModal>
  );
}
