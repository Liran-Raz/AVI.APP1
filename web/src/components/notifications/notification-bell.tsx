"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { he } from "date-fns/locale";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ApiError,
  apiClient,
  type NotificationDTO,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 3_000; // 3s — lightweight unread-count probe (paused when the tab is hidden)

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Light poll for the unread count. Only this lightweight endpoint
  // runs on the interval — the full list is fetched on demand when
  // the popover opens.
  const refreshCount = useCallback(async () => {
    try {
      const { count } = await apiClient.notifications.unreadCount();
      setUnreadCount(count);
    } catch {
      // Don't surface poll errors — the bell can stay quiet on
      // transient network blips. Failures show up in the popover.
    }
  }, []);

  useEffect(() => {
    // Initial sync with the external system (the API). setState lives
    // inside refreshCount but it's driven by the network response, not
    // by a render — same legitimate exception as polling subscriptions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCount();
    // Short poll for near-live notifications, but skip while the tab is hidden
    // and refresh the moment it becomes visible again (Stage 13). The
    // unread-count query is a cheap indexed count, safe at this cadence.
    const tick = () => {
      if (!document.hidden) void refreshCount();
    };
    const t = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshCount]);

  // Fetch the full list whenever the popover opens (cheap, max 20 rows).
  useEffect(() => {
    if (!popoverOpen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await apiClient.notifications.list({ limit: 20 });
        if (!cancelled) {
          setItems(result.items);
          setUnreadCount(result.unreadCount);
        }
      } catch (err) {
        if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
        else {
          toast.error("שגיאה לא צפויה");
          console.error(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [popoverOpen]);

  async function handleMarkRead(n: NotificationDTO) {
    if (n.readAt) return;
    // Optimistic update
    setItems((prev) =>
      prev
        ? prev.map((x) =>
            x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
          )
        : prev,
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await apiClient.notifications.markRead(n.id);
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      // Revert on failure
      void refreshCount();
    }
  }

  async function handleMarkAllRead() {
    const before = unreadCount;
    setItems((prev) =>
      prev
        ? prev.map((x) =>
            x.readAt ? x : { ...x, readAt: new Date().toISOString() },
          )
        : prev,
    );
    setUnreadCount(0);
    try {
      await apiClient.notifications.markAllRead();
      toast.success(`סומנו ${before} התראות כנקראו`);
    } catch (err) {
      if (err instanceof ApiError) toast.error(`שגיאה: ${err.message}`);
      void refreshCount();
    }
  }

  const hasUnread = unreadCount > 0;

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`התראות${hasUnread ? ` (${unreadCount} חדשות)` : ""}`}
          className="relative"
        >
          <Bell className="size-5" />
          {hasUnread && (
            <Badge
              variant="outline"
              className="absolute -top-1 -left-1 size-4 min-w-4 px-1 py-0 text-[10px] font-bold bg-destructive text-destructive-foreground border-destructive justify-center"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-3">
          <h3 className="font-semibold text-sm">התראות</h3>
          {hasUnread && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={handleMarkAllRead}
            >
              <CheckCheck className="size-3" />
              סמן הכל כנקרא
            </Button>
          )}
        </div>
        <Separator />
        <ScrollArea className="max-h-96">
          {loading && items === null ? (
            <div className="p-6 flex items-center justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : items && items.length > 0 ? (
            <div className="py-1">
              {items.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={() => handleMarkRead(n)}
                  onClick={() => setPopoverOpen(false)}
                />
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">
              אין התראות.
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function NotificationItem({
  notification,
  onMarkRead,
  onClick,
}: {
  notification: NotificationDTO;
  onMarkRead: () => void;
  onClick: () => void;
}) {
  const unread = notification.readAt === null;
  const when = formatDistanceToNow(new Date(notification.createdAt), {
    locale: he,
    addSuffix: true,
  });
  // Link the notification to the task it references when possible.
  const href = notification.taskId ? `/tasks` : null;

  const content = (
    <div className="flex items-start gap-2 px-3 py-2 hover:bg-muted/50 transition-colors">
      <div
        className={cn(
          "mt-1.5 size-2 rounded-full shrink-0",
          unread ? "bg-primary" : "bg-transparent",
        )}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm leading-snug",
            unread ? "font-medium" : "text-muted-foreground",
          )}
        >
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {notification.body}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">{when}</p>
      </div>
      {unread && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 opacity-60 hover:opacity-100"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMarkRead();
          }}
          aria-label="סמן כנקרא"
        >
          <Check className="size-3" />
        </Button>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} onClick={onClick} className="block">
        {content}
      </Link>
    );
  }
  return <button type="button" onClick={onClick} className="block w-full text-start">{content}</button>;
}
