"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Loader2,
  MessageSquare,
  Send,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ApiError, apiClient, type MemberDTO, type MessageDTO } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 3_000; // 3s, paused when the tab is hidden (Stage 13)
const GROUP = "group";

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
  return fresh.length ? [...prev, ...fresh] : prev;
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

  const [activeKey, setActiveKey] = useState<string>(GROUP);
  const [showListMobile, setShowListMobile] = useState(true);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const lastTsRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const activeLabel =
    activeKey === GROUP
      ? "כל המשרד"
      : dmMembers.find((m) => m.id === activeKey)?.fullName ?? "שיחה";

  // Load the active conversation and poll it for new messages. ONE effect keyed
  // on activeKey: switching conversations cancels any in-flight load/poll from
  // the previous one via the `cancelled` flag, so a late response can never
  // render into the wrong thread or clobber the shared cursor. The cursor is
  // reset on every switch.
  useEffect(() => {
    let cancelled = false;
    const key = activeKey;
    lastTsRef.current = undefined;

    const loadInitial = async () => {
      setLoading(true);
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

    // Kick off the initial load, then poll — both guarded by `cancelled`.
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
        recipientId: activeKey === GROUP ? null : activeKey,
      });
      // Show my message immediately, but do NOT advance the poll cursor past it:
      // an earlier not-yet-polled message from someone else must still arrive.
      // The next poll re-fetches from the old cursor and mergeNew dedups mine.
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

  return (
    <div className="h-full flex">
      {/* Conversation list (right side in RTL). On mobile: full-width, toggled. */}
      <aside
        className={cn(
          "w-full md:w-72 md:border-l border-border flex-col overflow-y-auto",
          showListMobile ? "flex" : "hidden",
          "md:flex",
        )}
      >
        <div className="px-4 py-3 border-b border-border">
          <h1 className="text-lg font-bold">הודעות</h1>
        </div>
        <nav className="p-2 space-y-1">
          <ConversationRow
            active={activeKey === GROUP}
            onClick={() => openConversation(GROUP)}
            icon={<Users className="size-4" />}
            title="כל המשרד"
            subtitle="הודעה לכל חברי הצוות"
          />
          {dmMembers.map((m) => (
            <ConversationRow
              key={m.id}
              active={activeKey === m.id}
              onClick={() => openConversation(m.id)}
              icon={
                <span className="text-xs font-medium">{initials(m.fullName)}</span>
              }
              title={m.fullName}
              subtitle="הודעה פרטית"
            />
          ))}
          {dmMembers.length === 0 ? (
            <p className="px-3 py-6 text-xs text-muted-foreground text-center">
              אין עדיין חברי צוות נוספים לשיחה פרטית.
            </p>
          ) : null}
        </nav>
      </aside>

      {/* Thread (left side). On mobile: shown when a conversation is open. */}
      <section
        className={cn(
          "flex-1 min-h-0 flex-col",
          showListMobile ? "hidden" : "flex",
          "md:flex",
        )}
      >
        {/* Thread header */}
        <div className="h-14 shrink-0 px-3 md:px-4 border-b border-border flex items-center gap-2 glass-topbar">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="חזרה לרשימת השיחות"
            onClick={() => setShowListMobile(true)}
          >
            <ChevronRight className="size-5" />
          </Button>
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
              {activeKey === GROUP ? (
                <Users className="size-4" />
              ) : (
                initials(activeLabel)
              )}
            </AvatarFallback>
          </Avatar>
          <span className="font-semibold text-sm truncate">{activeLabel}</span>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
          {loading && messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
              <MessageSquare className="size-8 opacity-50" />
              <p className="text-sm">אין עדיין הודעות. כתוב/י את הראשונה.</p>
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.senderId === currentUserId;
              const showName = activeKey === GROUP && !mine;
              return (
                <div
                  key={m.id}
                  className={cn("flex", mine ? "justify-start" : "justify-end")}
                >
                  <div
                    className={cn(
                      "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-card",
                      mine
                        ? "bg-primary text-primary-foreground rounded-bl-sm"
                        : "glass-card border border-border rounded-br-sm",
                    )}
                  >
                    {showName ? (
                      <div className="text-[11px] font-semibold opacity-80 mb-0.5">
                        {m.senderName}
                      </div>
                    ) : null}
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div
                      className={cn(
                        "text-[10px] mt-1 text-left",
                        mine ? "text-primary-foreground/70" : "text-muted-foreground",
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
        <div className="shrink-0 border-t border-border p-3 flex items-end gap-2 glass-card">
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
            className="flex-1 resize-none max-h-32 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
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
        "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-right transition-colors",
        active ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
      )}
    >
      <span className="size-9 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{title}</span>
        <span className="block text-xs text-muted-foreground truncate">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
