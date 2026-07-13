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
} from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { NewGroupDialog } from "./new-group-dialog";
import { GroupManageDialog } from "./group-manage-dialog";

const POLL_INTERVAL_MS = 3_000; // 3s, paused when the tab is hidden (Stage 13)
const OFFICE = "group"; // `with` value for the office-wide feed (unchanged since R1)
const CONV_PREFIX = "conv:"; // a custom group is addressed as "conv:<conversationId>"

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function mergeNew(prev: MessageDTO[], incoming: MessageDTO[]): MessageDTO[] {
  if (incoming.length === 0) return prev;
  const seen = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return prev;
  // Sort the merged list by (createdAt, id). An optimistic send does NOT advance the
  // poll cursor, so an earlier message from someone else can still arrive AFTER mine;
  // sorting keeps the thread in chronological order regardless of arrival order.
  return [...prev, ...fresh].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function groupKey(id: string): string {
  return CONV_PREFIX + id;
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
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const lastTsRef = useRef<string | undefined>(undefined);
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

  // Load the active conversation and poll it for new messages. ONE effect keyed on
  // activeKey: switching conversations cancels any in-flight load/poll from the
  // previous one via the `cancelled` flag, so a late response can never render into
  // the wrong thread or clobber the shared cursor. The cursor resets on each switch.
  useEffect(() => {
    let cancelled = false;
    const key = activeKey;
    lastTsRef.current = undefined;

    const loadInitial = async () => {
      setLoading(true);
      // Clear the previous thread immediately so a switch never renders the old
      // conversation's messages under the new header while the fetch is in flight.
      setMessages([]);
      try {
        const { items } = await apiClient.messages.list({ with: key, limit: 50 });
        if (cancelled) return;
        setMessages(items);
        lastTsRef.current = items.at(-1)?.createdAt;
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) toast.error(err.message);
        setMessages([]);
        lastTsRef.current = undefined;
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const poll = async () => {
      if (document.hidden) return;
      try {
        const { items } = await apiClient.messages.list({
          with: key,
          after: lastTsRef.current,
          limit: 100,
        });
        if (cancelled || items.length === 0) return;
        setMessages((prev) => mergeNew(prev, items));
        lastTsRef.current = items.at(-1)?.createdAt ?? lastTsRef.current;
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
      // Show my message immediately, but do NOT advance the poll cursor past it:
      // an earlier not-yet-polled message from someone else must still arrive.
      setMessages((prev) => mergeNew(prev, [msg]));
      setBody("");
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error("שליחת ההודעה נכשלה");
    } finally {
      setSending(false);
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
              const showName = showSenderNames && !mine;
              return (
                <div
                  key={m.id}
                  className={cn("flex", mine ? "justify-start" : "justify-end")}
                >
                  <div
                    className={cn(
                      "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-card",
                      mine
                        ? "rounded-bl-sm bg-primary text-primary-foreground"
                        : "glass-card rounded-br-sm border border-border",
                    )}
                  >
                    {showName ? (
                      <div className="mb-0.5 text-[11px] font-semibold opacity-80">
                        {m.senderName}
                      </div>
                    ) : null}
                    <div className="break-words whitespace-pre-wrap">{m.body}</div>
                    <div
                      className={cn(
                        "mt-1 text-left text-[10px]",
                        mine
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground",
                      )}
                      dir="ltr"
                    >
                      {fmtTime(m.createdAt)}
                    </div>
                  </div>
                </div>
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
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
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
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
