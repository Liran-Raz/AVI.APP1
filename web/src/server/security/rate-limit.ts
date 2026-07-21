import "server-only";
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { env } from "@/server/env";
import {
  RateLimitConfigError,
  RateLimitError,
} from "@/server/errors/app-error";

// ============================================================
// Rate limiting (F2)
// ============================================================
//
// Four modes, resolved at runtime:
//   • Upstash configured      → real sliding-window limiter (preview/prod).
//   • dev, no Upstash         → in-memory limiter (per-process; testing only).
//   • preview, no Upstash     → FAIL-OPEN (requests pass, loud log) — the
//     Vercel Preview env intentionally has no Upstash config.
//   • PRODUCTION, no Upstash  → FAIL-CLOSED (R3/#8): every guarded request
//     throws RateLimitConfigError (503). A production deployment must never
//     silently run its auth endpoints unprotected because an env var was
//     lost — same fail-loud contract as the email adapter (F7).
//
// Transient infrastructure problems still fail OPEN by design: a Redis
// outage or timeout at runtime must not take down sign-in / invite flows
// (availability over a momentary loss of throttling). Fail-closed applies
// ONLY to a missing configuration, which is a deployment mistake, not an
// outage.
//
// Privacy: callers pass an already-hashed email (see hashEmail) — the raw
// address is never used as a key. No request body, token, email, or Upstash
// secret is ever logged.

type WindowUnit = "s" | "m" | "h";
export type RateWindow = `${number} ${WindowUnit}`;
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const UPSTASH_CONFIGURED =
  !!env.UPSTASH_REDIS_REST_URL && !!env.UPSTASH_REDIS_REST_TOKEN;

// ------------------------------------------------------------
// Key helpers (no PII)
// ------------------------------------------------------------

// Hash the normalized email so the limiter key never stores a raw address.
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// Client IP, resilient to x-forwarded-for spoofing.
//
// On Vercel, `x-vercel-forwarded-for` and `x-real-ip` are set by the
// platform from the real TCP peer and cannot be overridden by a
// client-supplied header (Vercel strips inbound x-vercel-* and overwrites
// x-real-ip), so they are the trusted source. The leftmost token of a
// client-supplied `x-forwarded-for` IS spoofable (an attacker rotating it
// would get a fresh bucket every request), so we use it only as a last
// resort — i.e. non-Vercel hosting / local dev, where the limiter is in
// in-memory or fail-open mode anyway.
export function clientIp(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const ip = vercel.split(",")[0]?.trim();
    if (ip) return ip;
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

function windowToSeconds(window: RateWindow): number {
  const [nStr, unit] = window.split(" ");
  const n = Number.parseInt(nStr, 10);
  const mult = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return n * mult;
}

// ------------------------------------------------------------
// Upstash (preview / production)
// ------------------------------------------------------------

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL as string,
      token: env.UPSTASH_REDIS_REST_TOKEN as string,
    });
  }
  return redis;
}

const limiters = new Map<string, Ratelimit>();
function getLimiter(limit: number, window: RateWindow): Ratelimit {
  const cacheKey = `${limit}|${window}`;
  let l = limiters.get(cacheKey);
  if (!l) {
    l = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: "avi-rl",
      analytics: false,
    });
    limiters.set(cacheKey, l);
  }
  return l;
}

// ------------------------------------------------------------
// In-memory (DEVELOPMENT ONLY — per-process, not valid for serverless prod)
// ------------------------------------------------------------

const memStore = new Map<string, { count: number; resetAt: number }>();
function memoryLimit(
  fullKey: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  let entry = memStore.get(fullKey);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowSeconds * 1000 };
    memStore.set(fullKey, entry);
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

let warnedDev = false;
let warnedDisabled = false;

// True when a missing Upstash config must FAIL CLOSED instead of open:
// a real production deployment (Vercel Production, or a non-Vercel host
// running with NODE_ENV=production). Vercel Preview is excluded on
// purpose — it has no Upstash env by design and must keep working.
function mustFailClosedWithoutConfig(): boolean {
  if (env.VERCEL_ENV === "production") return true;
  if (!env.VERCEL_ENV && env.NODE_ENV === "production") return true;
  return false;
}

// Returns whether the request is allowed. Fails OPEN on transient infra
// problems (Redis outage/timeout) so legitimate users are never blocked by
// an Upstash hiccup. The ONE case that throws is a missing Upstash config
// in production — RateLimitConfigError (503), see the header comment.
export async function checkRateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  window: RateWindow,
): Promise<RateLimitResult> {
  const fullKey = `${bucket}:${identifier}`;

  if (UPSTASH_CONFIGURED) {
    try {
      const res = await getLimiter(limit, window).limit(fullKey);
      const retryAfterSeconds = res.success
        ? 0
        : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000));
      return { allowed: res.success, retryAfterSeconds };
    } catch (err) {
      console.error(
        "[rate-limit] Upstash error — failing OPEN:",
        err instanceof Error ? err.message : "unknown",
      );
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  if (env.NODE_ENV === "development") {
    if (!warnedDev) {
      console.warn(
        "[rate-limit] DEV in-memory limiter active (per-process only; NOT valid for production). Set UPSTASH_REDIS_REST_URL/TOKEN to use Upstash.",
      );
      warnedDev = true;
    }
    return memoryLimit(fullKey, limit, windowToSeconds(window));
  }

  // PRODUCTION without Upstash env → fail CLOSED (R3/#8). A lost env var
  // must surface as a loud 503 on the guarded endpoints, never as a
  // silently unprotected production. The log carries the actionable
  // detail; the thrown error is generic (no config internals to clients).
  if (mustFailClosedWithoutConfig()) {
    console.error(
      "[rate-limit] FAIL-CLOSED — UPSTASH_REDIS_REST_URL/TOKEN missing in production. Guarded endpoints return 503 until the env vars are restored in Vercel.",
    );
    throw new RateLimitConfigError();
  }

  // Vercel Preview without Upstash env → fail open (never in-memory).
  // Preview deliberately carries no Upstash config; auth there is out of
  // scope, but the deployment itself must keep working.
  if (!warnedDisabled) {
    console.error(
      "[rate-limit] DISABLED — UPSTASH_REDIS_REST_URL/TOKEN missing in a non-development environment. Requests pass through (fail-open). Add the env vars in Vercel to enable real rate limiting.",
    );
    warnedDisabled = true;
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

// Throwing variant for API routes: raises a clean RateLimitError (429) when
// the limit is exceeded. withErrorHandler turns it into the uniform body
// { code: "RATE_LIMITED", message } plus a Retry-After header. Also lets
// checkRateLimit's production fail-closed RateLimitConfigError (503)
// propagate untouched.
export async function enforceRateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  window: RateWindow,
): Promise<void> {
  const result = await checkRateLimit(bucket, identifier, limit, window);
  if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds);
}
