"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Users,
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ApiError,
  apiClient,
  type GroupDetailDTO,
  type GroupSummaryDTO,
  type MemberDTO,
  type MessageDTO,
  type ReadStateDTO,
  type UnreadCountsDTO,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { mergeNew, newestMs, reconcile } from "./message-merge";
import { MessageItem } from "./message-item";
import { NewGroupDialog } from "./new-group-dialog";
import { GroupManageDialog } from "./group-manage-dialog";

const POLL_INTERVAL_MS = 3_000; // 3s, paused when the tab is hidden (Stage 13)
const UNREAD_POLL_MS = 4_000; // unread badge cadence (all conversations)
const OFFICE = "group"; // `with` value for the office-wide feed (unchanged since R1)
const CONV_PREFIX = "conv:"; // a custom group is addressed as "conv:<conversationId>"

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

function groupKey(id: string): string {
  return CONV_PREFIX + id;
}

// Optimistically zero a conversation's unread when I open it (the server catches up
// on the next poll after mark-read). Keeps the badge from lingering while I read.
function clearUnreadFor(u: UnreadCountsDTO, key: string): UnreadCountsDTO {
  if (key === OFFICE) {
    return { ...u, office: 0, total: Math.max(0, u.total - u.office) };
  }
  if (key.startsWith(CONV_PREFIX)) {
    const id = key.slice(CONV_PREFIX.length);
    const n = u.groups[id] ?? 0;
    const groups = { ...u.groups };
    delete groups[id];
    return { ...u, groups, total: Math.max(0, u.total - n) };
  }
  const n = u.dms[key] ?? 0;
  const dms = { ...u.dms };
  delete dms[key];
  return { ...u, dms, total: Math.max(0, u.total - n) };
}

export function MessagesPage({
  currentUserId,
  members,
}: {
  currentUserId: string;
  members: MemberDTO[];
}) {
  // DM targets = active members other than me. The office group is always first.
  const dmMembers = members.filter((m) => m.isActive && m.id !== currentUserId);

  const [groups, setGroups] = useState<GroupSummaryDTO[]>([]);
  const [activeKey, setActiveKey] = useState<string>(OFFICE);
  const [showListMobile, setShowListMobile] = useState(true);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [readState, setReadState] = useState<ReadStateDTO>({ recipients: [] });
  const [unread, setUnread] = useState<UnreadCountsDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const lastTsRef = useRef<number>(0); // newest message time (ms) seen — gates mark-read
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const activeGroupId = activeKey.startsWith(CONV_PREFIX)
    ? activeKey.slice(CONV_PREFIX.length)
    : null;
  const activeGroup = activeGroupId
    ? groups.find((g) => g.id === activeGroupId) ?? null
    : null;
  const isOffice = activeKey === OFFICE;
  const showSenderNames = isOffice || activeGroupId !== null;

  const activeLabel = isOffice
    ? "כל המשרד"
    : activeGroup
      ? activeGroup.title
      : activeGroupId
        ? "קבוצה"
        : (dmMembers.find((m) => m.id === activeKey)?.fullName ?? "שיחה");

  // The timestamp through which EVERY recipient has read (min of their last_read_at,
  // or null if any recipient has never read). A message of mine is ✓✓ (read-by-all)
  // when its createdAt <= readThrough.
  const readThrough = (() => {
    const recs = readState.recipients;
    if (recs.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    for (const r of recs) {
      if (!r.lastReadAt) return null;
      const t = Date.parse(r.lastReadAt);
      if (t < min) min = t;
    }
    return min;
  })();

  // Load the caller's group conversations once on mount. (Office + DMs come from the
  // roster prop.) Local updates from the dialogs keep this in sync afterward.
  useEffect(() => {
    let cancelled = false;
    apiClient.conversations
      .list()
      .then((res) => {
        if (!cancelled) setGroups(res.items);
      })
      .catch(() => {
        // non-fatal: groups just won't show until a refresh
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the active conversation and poll it. ONE effect keyed on activeKey: switching
  // conversations cancels any in-flight load/poll from the previous one via `cancelled`,
  // so a late response can never render into the wrong thread or clobber the cursor.
  useEffect(() => {
    let cancelled = false;
    const key = activeKey;
    lastTsRef.current = 0;

    // Mark the conversation read (best-effort) + optimistically clear its badge.
    const markRead = async () => {
      try {
        await apiClient.messages.markRead(key);
      } catch {
        // non-critical
      }
      if (!cancelled) setUnread((u) => (u ? clearUnreadFor(u, key) : u));
    };

    const loadInitial = async () => {
      setLoading(true);
      // Clear the previous thread immediately so a switch never renders the old
      // conversation's messages/read-state under the new header while loading.
      setMessages([]);
      setReadState({ recipients: [] });
      try {
        const res = await apiClient.messages.list({ with: key, limit: 50 });
        if (cancelled) return;
        setMessages(res.items);
        setReadState(res.readState);
        lastTsRef.current = newestMs(res.items);
        void markRead();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) toast.error(err.message);
        setMessages([]);
        lastTsRef.current = 0;
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const poll = async () => {
      if (document.hidden) return;
      try {
        // Re-fetch the recent window (NOT a created_at delta) so edits/soft-deletes by
        // others — which don't move created_at — are reflected. reconcile() returns the
        // same reference (no re-render) when nothing changed.
        const res = await apiClient.messages.list({ with: key, limit: 50 });
        if (cancelled) return;
        setReadState(res.readState); // refresh ✓/✓✓ live
        setMessages((prev) => reconcile(prev, res.items));
        const newest = newestMs(res.items);
        if (newest > lastTsRef.current) {
          lastTsRef.current = newest;
          void markRead(); // a genuinely-new message arrived while I'm viewing
        }
      } catch {
        // stay quiet on transient poll blips
      }
    };

    void loadInitial();
    const t = setInterval(poll, POLL_INTERVAL_MS);
    const onVis = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeKey]);

  // Poll unread counts across ALL conversations (for the row badges), paused when hidden.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const u = await apiClient.messages.unread();
        if (!cancelled) setUnread(u);
      } catch {
        // non-critical
      }
    };
    void load();
    const t = setInterval(load, UNREAD_POLL_MS);
    const onVis = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Keep the view pinned to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function handleSend() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await apiClient.messages.send({
        body: text,
        recipientId: isOffice || activeGroupId ? null : activeKey,
        conversationId: activeGroupId ?? undefined,
      });
      // Show my message immediately. The recent-window poll re-fetches + reconciles by
      // id, so nothing is missed; advancing the mark-read gate past my own send just
      // avoids a redundant mark-read on the next poll.
      setMessages((prev) => mergeNew(prev, [msg]));
      lastTsRef.current = Math.max(lastTsRef.current, Date.parse(msg.createdAt));
      setBody("");
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error("שליחת ההודעה נכשלה");
    } finally {
      setSending(false);
    }
  }

  // R4 — edit / delete my own message (≤10 min; the DB is authoritative). Errors are
  // surfaced as a toast and swallowed so the message item can exit its busy state.
  async function handleEdit(id: string, newBody: string) {
    try {
      const updated = await apiClient.messages.edit(id, { body: newBody });
      setMessages((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "עריכת ההודעה נכשלה");
      throw err; // keep the editor open + preserve the typed draft on failure
    }
  }

  async function handleDelete(id: string) {
    try {
      const updated = await apiClient.messages.remove(id);
      setMessages((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "מחיקת ההודעה נכשלה");
    }
  }

  function openConversation(key: string) {
    setActiveKey(key);
    setShowListMobile(false);
  }

  // ---- group dialog callbacks ----
  function handleGroupCreated(group: GroupSummaryDTO) {
    setGroups((prev) => [group, ...prev.filter((g) => g.id !== group.id)]);
    openConversation(groupKey(group.id));
  }

  function handleGroupChanged(detail: GroupDetailDTO) {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === detail.id
          ? {
              ...g,
              title: detail.title,
              isAdmin: detail.isAdmin,
              memberCount: detail.members.length,
            }
          : g,
      ),
    );
  }

  function handleGroupLeftOrDeleted() {
    const id = activeGroupId;
    if (id) setGroups((prev) => prev.filter((g) => g.id !== id));
    setActiveKey(OFFICE);
    setShowListMobile(true);
  }

  return (
    <div className="flex h-full">
      {/* Conversation list (right side in RTL). On mobile: full-width, toggled. */}
      <aside
        className={cn(
          "w-full flex-col overflow-y-auto border-l border-border md:w-72",
          showListMobile ? "flex" : "hidden",
          "md:flex",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h1 className="text-lg font-bold">הודעות</h1>
          <button
            type="button"
            onClick={() => setNewGroupOpen(true)}
            className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
          >
            <Plus className="size-3.5" />
            קבוצה חדשה
          </button>
        </div>
        <nav className="space-y-1 p-2">
          <ConversationRow
            active={isOffice}
            onClick={() => openConversation(OFFICE)}
            icon={<Users className="size-4" />}
            title="כל המשרד"
            subtitle="הודעה לכל חברי הצוות"
            unreadCount={unread?.office ?? 0}
          />

          {groups.length > 0 ? (
            <p className="px-3 pt-3 pb-1 text-[11px] font-bold text-muted-foreground">
              קבוצות
            </p>
          ) : null}
          {groups.map((g) => (
            <ConversationRow
              key={g.id}
              active={activeGroupId === g.id}
              onClick={() => openConversation(groupKey(g.id))}
              icon={<UsersRound className="size-4" />}
              title={g.title}
              subtitle={`${g.memberCount} חברים`}
              unreadCount={unread?.groups[g.id] ?? 0}
            />
          ))}

          <p className="px-3 pt-3 pb-1 text-[11px] font-bold text-muted-foreground">
            הודעות פרטיות
          </p>
          {dmMembers.map((m) => (
            <ConversationRow
              key={m.id}
              active={activeKey === m.id}
              onClick={() => openConversation(m.id)}
              icon={<span className="text-xs font-medium">{initials(m.fullName)}</span>}
              title={m.fullName}
              subtitle="הודעה פרטית"
              unreadCount={unread?.dms[m.id] ?? 0}
            />
          ))}
          {dmMembers.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              אין עדיין חברי צוות נוספים לשיחה פרטית.
            </p>
          ) : null}
        </nav>
      </aside>

      {/* Thread (left side). On mobile: shown when a conversation is open. */}
      <section
        className={cn(
          "min-h-0 flex-1 flex-col",
          showListMobile ? "hidden" : "flex",
          "md:flex",
        )}
      >
        {/* Thread header — for a group, the whole bar opens the manage panel. */}
        <div className="glass-topbar flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="חזרה לרשימת השיחות"
            onClick={() => setShowListMobile(true)}
          >
            <ChevronRight className="size-5" />
          </Button>

          <button
            type="button"
            disabled={!activeGroupId}
            onClick={() => setManageOpen(true)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-right",
              activeGroupId ? "cursor-pointer hover:bg-muted/50" : "cursor-default",
            )}
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {isOffice ? (
                  <Users className="size-4" />
                ) : activeGroupId ? (
                  <UsersRound className="size-4" />
                ) : (
                  initials(activeLabel)
                )}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {activeLabel}
              </span>
              {activeGroup ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {activeGroup.memberCount} חברים · הקש/י לפרטים
                </span>
              ) : null}
            </span>
            {activeGroupId ? (
              <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
            ) : null}
          </button>
        </div>

        {/* Messages */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-gradient-to-b from-white/50 to-white/30 p-4">
          {loading && messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <MessageSquare className="size-8 opacity-50" />
              <p className="text-sm">אין עדיין הודעות. כתוב/י את הראשונה.</p>
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.senderId === currentUserId;
              return (
                <MessageItem
                  key={m.id}
                  message={m}
                  mine={mine}
                  showSenderName={showSenderNames && !mine}
                  readByAll={
                    readThrough != null && Date.parse(m.createdAt) <= readThrough
                  }
                  recipients={readState.recipients}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="glass-card flex shrink-0 items-end gap-2 border-t border-border p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            placeholder="כתוב/י הודעה…"
            className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button
            size="icon"
            onClick={() => void handleSend()}
            disabled={sending || body.trim().length === 0}
            aria-label="שליחה"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </section>

      {/* Create-group + manage dialogs (responsive: bottom-sheet on mobile). */}
      <NewGroupDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        candidates={dmMembers}
        onCreated={handleGroupCreated}
      />
      <GroupManageDialog
        key={activeGroupId ?? "none"}
        open={manageOpen}
        onOpenChange={setManageOpen}
        conversationId={activeGroupId}
        roster={members}
        currentUserId={currentUserId}
        onChanged={handleGroupChanged}
        onLeftOrDeleted={handleGroupLeftOrDeleted}
      />
    </div>
  );
}

function ConversationRow({
  active,
  onClick,
  icon,
  title,
  subtitle,
  unreadCount = 0,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  unreadCount?: number;
}) {
  // The active conversation is being read, so never badge it.
  const showBadge = !active && unreadCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-right transition-colors",
        active ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            showBadge ? "font-bold" : "font-medium",
          )}
        >
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
      {showBadge ? (
        <span className="flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#16a34a] px-1.5 text-[11px] font-bold text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  );
}
