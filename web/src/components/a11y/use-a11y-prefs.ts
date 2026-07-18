"use client";

import { useCallback, useEffect, useState } from "react";

import {
  applyPrefs,
  readPrefs,
  writePrefs,
  TEXT_LEVELS,
  type A11yPrefs,
  type CursorMode,
  type FlagKey,
} from "./a11y-prefs";

// Shared accessibility-preferences state + handlers (DEV-028). Used by BOTH the
// floating widget (public pages) and the Settings → Accessibility tab (in-app),
// so the two presentations stay in perfect sync via localStorage + the <html>
// data-attributes. They are never mounted at the same time, so each instance
// keeping its own React state is fine.
export function useA11yPrefs() {
  const [prefs, setPrefs] = useState<A11yPrefs>({});

  // Hydrate from storage after mount. The inline no-flash script already applied
  // it to <html>; re-apply defensively in case the script was blocked.
  useEffect(() => {
    const stored = readPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(stored);
    applyPrefs(stored);
  }, []);

  // Functional updater: computes the next prefs from the LATEST state (never a
  // stale closure), then applies + persists. applyPrefs/writePrefs are
  // idempotent, so React's dev double-invoke is harmless.
  const mutate = useCallback((fn: (prev: A11yPrefs) => A11yPrefs) => {
    setPrefs((prev) => {
      const next = fn(prev);
      applyPrefs(next);
      writePrefs(next);
      return next;
    });
  }, []);

  const cycleText = useCallback(
    () =>
      mutate((prev) => {
        const order: Array<A11yPrefs["text"]> = [undefined, ...TEXT_LEVELS];
        const nextText = order[(order.indexOf(prev.text) + 1) % order.length];
        const next = { ...prev };
        if (nextText) next.text = nextText;
        else delete next.text;
        return next;
      }),
    [mutate],
  );

  const toggleFlag = useCallback(
    (k: FlagKey) =>
      mutate((prev) => {
        const next = { ...prev };
        if (next[k]) delete next[k];
        else next[k] = true;
        return next;
      }),
    [mutate],
  );

  const setCursor = useCallback(
    (mode: CursorMode) =>
      mutate((prev) => {
        const next = { ...prev };
        if (next.cursor === mode) delete next.cursor;
        else next.cursor = mode;
        return next;
      }),
    [mutate],
  );

  const reset = useCallback(() => mutate(() => ({})), [mutate]);

  const textLevel = prefs.text ? TEXT_LEVELS.indexOf(prefs.text) + 1 : 0;

  return { prefs, cycleText, toggleFlag, setCursor, reset, textLevel };
}
