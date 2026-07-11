"use client";

import { useEffect, useRef } from "react";

import { apiClient } from "@/lib/api-client";

// Live board refresh (Stage 13 R6). Polls a cheap "version" signal every
// `intervalMs` and calls `onChange` ONLY when it changes, so another user's
// task changes appear automatically without a manual refresh.
//
// Efficiency (why frequent polling is safe here):
//   * The poll hits GET /api/tasks/version, which returns a tiny string. The
//     full board (apiClient.tasks.list) is refetched only when the signal
//     actually changed — so the 3s cadence costs ~a few hundred bytes/sec.
//   * Paused while the tab is hidden (document.hidden); does an immediate check
//     the moment the tab becomes visible again (catches up on changes made
//     while away).
//   * Recursive setTimeout (not setInterval) so a slow request never stacks.
//   * A baseline version is seeded on mount WITHOUT refetching (the SSR initial
//     data is already fresh), so we only refetch on genuine subsequent changes.
export function useLiveTaskRefresh(onChange: () => void, intervalMs = 3000) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const lastVersion = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll(force = false) {
      if (stopped) return;
      if (!force && document.hidden) return; // paused when the tab is hidden
      try {
        const { version } = await apiClient.tasks.version();
        if (stopped) return;
        if (lastVersion.current === null) {
          lastVersion.current = version; // seed baseline, no refetch
        } else if (version !== lastVersion.current) {
          lastVersion.current = version;
          onChangeRef.current();
        }
      } catch {
        // Transient (offline / session expiry) — the next tick retries.
      }
    }

    // Seed a baseline immediately, even if the tab starts hidden, so returning
    // to the tab can detect changes that happened while it was in the background.
    void poll(true);

    function loop() {
      void poll().finally(() => {
        if (!stopped) timer = setTimeout(loop, intervalMs);
      });
    }
    timer = setTimeout(loop, intervalMs);

    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
