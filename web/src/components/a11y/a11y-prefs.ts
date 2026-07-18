// Accessibility widget preferences (DEV-028). Plain module — NOT a component,
// no "use client": the helpers touch `document` only when CALLED (client-side),
// and the server root layout imports only A11Y_INIT_SCRIPT (a string). The
// choices are applied as data-attributes on <html>; the matching CSS lives in
// app/globals.css. Persisted to localStorage so they survive navigation/reload.

export const A11Y_STORAGE_KEY = "avi-a11y";

/** Multi-level text-size steps (cycled by the button). */
export const TEXT_LEVELS = ["lg", "xl", "xxl"] as const;
export type TextLevel = (typeof TEXT_LEVELS)[number];
export type CursorMode = "big" | "black";

/** Boolean adjustments — each maps to a bare `data-a11y-<key>` attribute. */
export const FLAG_KEYS = [
  "contrast",
  "links",
  "headings",
  "font",
  "spacing",
  "motion",
] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

export type A11yPrefs = {
  text?: TextLevel;
  cursor?: CursorMode;
} & Partial<Record<FlagKey, boolean>>;

/** Read the saved prefs (SSR-safe: returns {} when no window/localStorage). */
export function readPrefs(): A11yPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(A11Y_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as A11yPrefs) : {};
  } catch {
    return {};
  }
}

/** Persist prefs; empty object clears the key. */
export function writePrefs(prefs: A11yPrefs): void {
  try {
    if (Object.keys(prefs).length === 0) {
      window.localStorage.removeItem(A11Y_STORAGE_KEY);
    } else {
      window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(prefs));
    }
  } catch {
    /* private-mode / storage disabled — the runtime attributes still apply */
  }
}

/** Apply prefs to <html> as data-attributes (mirrors A11Y_INIT_SCRIPT). */
export function applyPrefs(prefs: A11yPrefs): void {
  const el = document.documentElement;
  el.toggleAttribute("data-a11y-text", false);
  if (prefs.text) el.setAttribute("data-a11y-text", prefs.text);
  else el.removeAttribute("data-a11y-text");

  for (const k of FLAG_KEYS) {
    if (prefs[k]) el.setAttribute(`data-a11y-${k}`, "");
    else el.removeAttribute(`data-a11y-${k}`);
  }

  if (prefs.cursor) el.setAttribute("data-a11y-cursor", prefs.cursor);
  else el.removeAttribute("data-a11y-cursor");
}

/** True when any adjustment is active (drives the "reset" affordance). */
export function hasAnyPref(prefs: A11yPrefs): boolean {
  return Object.values(prefs).some(Boolean);
}

// The pre-hydration no-flash script lives in `public/a11y-init.js` (loaded
// beforeInteractive by the root layout), NOT here — serving it as a static file
// keeps React 19 from warning about an inline <script> in the render tree. It
// mirrors A11Y_STORAGE_KEY + FLAG_KEYS + the text/cursor attributes; keep the
// two in sync if you add an adjustment.
