"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";

// Topbar connectivity indicators:
//   A — database reachability, via the authenticated /api/health/db
//       probe on a light poll (bell-style interval) + window focus +
//       browser 'online' events.
//   B — internet connectivity, via navigator.onLine + online/offline
//       listeners (client-side only; no network cost).
//
// Tri-state per indicator: true = ok (green), false = down (red,
// pulsing), null = unknown/neutral (gray) — pre-mount, or a 401 on the
// DB probe (an expired session is not a DB fault).
const DB_POLL_INTERVAL_MS = 45_000;

type IndicatorState = boolean | null;

function dotClass(state: IndicatorState): string {
  if (state === true) return "bg-emerald-500";
  if (state === false) return "bg-destructive animate-pulse";
  return "bg-muted-foreground/30";
}

function stateTextKey(state: IndicatorState): MessageKey {
  if (state === true) return "connectivity.connected";
  if (state === false) return "connectivity.down";
  return "connectivity.checking";
}

export function TopbarConnectivity() {
  const t = useT();
  const [dbOk, setDbOk] = useState<IndicatorState>(null);
  const [online, setOnline] = useState<IndicatorState>(null);

  const checkDb = useCallback(async () => {
    try {
      await apiClient.health.db();
      setDbOk(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Session expired / signed out — not a DB outage. Stay neutral.
        setDbOk(null);
      } else {
        setDbOk(false);
      }
    }
  }, []);

  useEffect(() => {
    // Initial sync with external systems (browser online state + the
    // probe endpoint) — same legitimate exception as the bell's poll.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(navigator.onLine);
    void checkDb();

    const t = setInterval(() => void checkDb(), DB_POLL_INTERVAL_MS);
    const onFocus = () => void checkDb();
    const onOnline = () => {
      setOnline(true);
      void checkDb();
    };
    const onOffline = () => {
      setOnline(false);
      // No internet ⇒ the DB is unreachable from this browser too.
      setDbOk(false);
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [checkDb]);

  const dbTitle = t("connectivity.dbTitle", { state: t(stateTextKey(dbOk)) });
  const netTitle = t("connectivity.netTitle", { state: t(stateTextKey(online)) });

  return (
    <div
      className="flex h-8 items-center gap-2 rounded-full border border-border/60 bg-card/40 px-2.5"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-1.5" title={dbTitle} aria-label={dbTitle}>
        <span
          className={cn("size-2 shrink-0 rounded-full", dotClass(dbOk))}
          aria-hidden
        />
        <span className="hidden md:inline text-[10px] leading-none text-muted-foreground">
          {t("connectivity.db")}
        </span>
      </span>
      <span className="h-3 w-px bg-border/70" aria-hidden />
      <span className="flex items-center gap-1.5" title={netTitle} aria-label={netTitle}>
        <span
          className={cn("size-2 shrink-0 rounded-full", dotClass(online))}
          aria-hidden
        />
        <span className="hidden md:inline text-[10px] leading-none text-muted-foreground">
          {t("connectivity.net")}
        </span>
      </span>
    </div>
  );
}
