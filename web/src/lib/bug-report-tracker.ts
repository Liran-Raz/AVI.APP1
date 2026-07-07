// Client-side activity tracker for "מצאת תקלה?" (DEV-002). Browser-only —
// every export here is safe to import from a "use client" component; the
// actual instrumentation (patching console.error / window.fetch, attaching
// the click listener) only runs when init() is called AND `window` exists.
//
// NOT a general-purpose telemetry system: three small capped ring buffers,
// nothing persisted, nothing sent anywhere until the user explicitly submits
// a bug report. No server-side component (explicit DEV-002 scope decision).
//
// Caps here MUST stay in sync with server/validators/bug-reports.schema.ts
// (consoleErrors/failedRequests max 20, actionTrail max 30) — kept in sync
// manually, both are small stable constants.

import type { ClientLogsPayload } from "@/server/validators/bug-reports.schema";

const CONSOLE_ERROR_CAP = 20;
const FAILED_REQUEST_CAP = 20;
const ACTION_TRAIL_CAP = 30;

const MESSAGE_MAX_LEN = 500;
const LABEL_MAX_LEN = 200;
const URL_MAX_LEN = 300;

type ConsoleErrorEntry = { message: string; timestamp: string };
type FailedRequestEntry = {
  url: string;
  method: string;
  status?: number;
  timestamp: string;
};
type ActionEntry = { label: string; timestamp: string };

const consoleErrors: ConsoleErrorEntry[] = [];
const failedRequests: FailedRequestEntry[] = [];
const actionTrail: ActionEntry[] = [];

function pushCapped<T>(buf: T[], entry: T, cap: number): void {
  buf.push(entry);
  if (buf.length > cap) buf.shift();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function nowIso(): string {
  return new Date().toISOString();
}

let initialized = false;

// Idempotent — safe to call on every mount of the report-bug button; the
// actual patching happens once. No-ops on the server.
export function initBugReportTracker(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  patchConsoleError();
  patchFetch();
  attachClickListener();
}

function patchConsoleError(): void {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    // Never suppress the real console.error — this is purely additive.
    original(...args);
    try {
      const message = truncate(
        args
          .map((a) => (typeof a === "string" ? a : safeStringify(a)))
          .join(" "),
        MESSAGE_MAX_LEN,
      );
      pushCapped(consoleErrors, { message, timestamp: nowIso() }, CONSOLE_ERROR_CAP);
    } catch {
      // Tracking must never itself throw or affect the real console.error.
    }
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function patchFetch(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    try {
      const res = await original(...args);
      if (!res.ok) {
        pushCapped(
          failedRequests,
          {
            url: truncate(url, URL_MAX_LEN),
            method: truncate(method, 10),
            status: res.status,
            timestamp: nowIso(),
          },
          FAILED_REQUEST_CAP,
        );
      }
      return res;
    } catch (err) {
      // Network-level failure (no response at all).
      pushCapped(
        failedRequests,
        {
          url: truncate(url, URL_MAX_LEN),
          method: truncate(method, 10),
          timestamp: nowIso(),
        },
        FAILED_REQUEST_CAP,
      );
      throw err;
    }
  };
}

function attachClickListener(): void {
  document.addEventListener(
    "click",
    (event) => {
      try {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const interactive = target.closest(
          'button, a, [role="button"], input[type="submit"]',
        );
        if (!interactive) return;
        const label =
          interactive.getAttribute("aria-label")?.trim() ||
          interactive.textContent?.trim() ||
          interactive.tagName.toLowerCase();
        recordAction(truncate(label, LABEL_MAX_LEN));
      } catch {
        // Tracking must never break the real click handling.
      }
    },
    { capture: true },
  );
}

// Public — components (e.g. route-change effects) can also record their own
// labeled actions, not just clicks.
export function recordAction(label: string): void {
  pushCapped(
    actionTrail,
    { label: truncate(label, LABEL_MAX_LEN), timestamp: nowIso() },
    ACTION_TRAIL_CAP,
  );
}

// Snapshot the current buffers for submission. Returns copies — the report
// dialog can hold this while the user types without buffers mutating under it.
export function getClientLogsSnapshot(): ClientLogsPayload {
  return {
    consoleErrors: [...consoleErrors],
    failedRequests: [...failedRequests],
    actionTrail: [...actionTrail],
  };
}
