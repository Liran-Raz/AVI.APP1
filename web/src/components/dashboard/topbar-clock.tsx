"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

// Live clock + current date for the topbar.
//
// Hydration-safe: the server knows no client time, so the first client
// render must match SSR output — we render an invisible fixed-width
// placeholder until mounted, then an interval takes over. Same
// mount-then-set discipline as the notification bell's poll loop.
export function TopbarClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Initial sync with the external system (the wall clock) — same
    // legitimate exception as the bell's polling subscription.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(t);
  }, []);

  const time = now
    ? now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : null;
  const date = now
    ? now.toLocaleDateString("he-IL", {
        weekday: "short",
        day: "numeric",
        month: "long",
      })
    : null;

  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      aria-label={now ? `השעה ${time}, ${date}` : "שעון"}
    >
      <Clock className="hidden sm:block size-3.5" aria-hidden />
      {now ? (
        <>
          <span className="tabular-nums font-medium text-foreground/80">
            {time}
          </span>
          {/* Date is desktop-only — the mobile topbar is width-constrained */}
          <span className="hidden sm:inline" aria-hidden>
            ·
          </span>
          <span className="hidden sm:inline whitespace-nowrap">{date}</span>
        </>
      ) : (
        // Reserve the time's width pre-mount to avoid a layout shift.
        <span className="tabular-nums opacity-0 select-none" aria-hidden>
          00:00
        </span>
      )}
    </div>
  );
}
