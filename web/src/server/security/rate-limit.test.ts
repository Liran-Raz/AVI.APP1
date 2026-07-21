import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tests the MODE SELECTION of rate-limit.ts (R3/#8): Upstash configured →
// real limiter; dev → in-memory; preview without config → fail-open;
// PRODUCTION without config → fail-CLOSED (RateLimitConfigError, 503).
//
// checkRateLimit reads the validated env module and computes a module-level
// UPSTASH_CONFIGURED constant, so each scenario resets the module registry
// and re-imports a fresh copy with a mocked "@/server/env".
//
// NOTE: assertions use error PROPERTIES (name/code/status), never
// instanceof — vi.resetModules() gives the re-imported module its own copy
// of the error classes, so instanceof against this file's import would
// always be false.

type EnvShape = {
  NODE_ENV: "development" | "test" | "production";
  VERCEL_ENV?: "production" | "preview" | "development";
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

type LimitResult = { success: boolean; reset: number };
type LimitImpl = (key: string) => Promise<LimitResult>;

async function loadWith(envShape: EnvShape, limitImpl?: LimitImpl) {
  vi.resetModules();
  vi.doMock("@/server/env", () => ({ env: envShape }));
  if (limitImpl) {
    // Bare mocks: JS classes accept constructor/static args without declaring them.
    vi.doMock("@upstash/redis", () => ({
      Redis: class {},
    }));
    vi.doMock("@upstash/ratelimit", () => ({
      Ratelimit: class {
        static slidingWindow(): unknown {
          return {};
        }
        limit = limitImpl;
      },
    }));
  }
  return await import("./rate-limit");
}

const UPSTASH = {
  UPSTASH_REDIS_REST_URL: "https://fake.upstash.example",
  UPSTASH_REDIS_REST_TOKEN: "fake-token",
} as const;

// Await a promise that must reject and return the thrown value.
async function captureError(p: Promise<unknown>): Promise<{
  name?: string;
  code?: string;
  status?: number;
  message?: string;
}> {
  try {
    await p;
  } catch (e) {
    return e as { name?: string; code?: string; status?: number };
  }
  throw new Error("Expected promise to reject, but it resolved");
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  vi.doUnmock("@/server/env");
  vi.doUnmock("@upstash/redis");
  vi.doUnmock("@upstash/ratelimit");
  vi.resetModules();
});

describe("checkRateLimit — production without Upstash fails CLOSED", () => {
  it("throws RateLimitConfigError on Vercel Production", async () => {
    const mod = await loadWith({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    });
    const err = await captureError(mod.checkRateLimit("b", "id", 5, "15 m"));
    expect(err.name).toBe("RateLimitConfigError");
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.status).toBe(503);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("throws on a non-Vercel production host (no VERCEL_ENV)", async () => {
    const mod = await loadWith({ NODE_ENV: "production" });
    const err = await captureError(mod.checkRateLimit("b", "id", 5, "15 m"));
    expect(err.name).toBe("RateLimitConfigError");
  });

  it("propagates through enforceRateLimit", async () => {
    const mod = await loadWith({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    });
    const err = await captureError(mod.enforceRateLimit("b", "id", 5, "15 m"));
    expect(err.name).toBe("RateLimitConfigError");
  });

  it("keeps the client message generic (no config internals)", async () => {
    const mod = await loadWith({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    });
    const err = await captureError(mod.checkRateLimit("b", "id", 5, "15 m"));
    expect(err.message).toBe("Service temporarily unavailable");
    expect(err.message).not.toMatch(/upstash|redis|rate/i);
  });
});

describe("checkRateLimit — preview without Upstash fails OPEN", () => {
  it("allows the request and logs loudly", async () => {
    const mod = await loadWith({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
    });
    const res = await mod.checkRateLimit("b", "id", 5, "15 m");
    expect(res.allowed).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("checkRateLimit — development in-memory limiter", () => {
  it("counts per key and blocks past the limit", async () => {
    const mod = await loadWith({ NODE_ENV: "development" });
    expect((await mod.checkRateLimit("b", "k1", 2, "10 s")).allowed).toBe(true);
    expect((await mod.checkRateLimit("b", "k1", 2, "10 s")).allowed).toBe(true);
    const third = await mod.checkRateLimit("b", "k1", 2, "10 s");
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    // A different key has its own bucket.
    expect((await mod.checkRateLimit("b", "k2", 2, "10 s")).allowed).toBe(true);
  });

  it("enforceRateLimit raises RATE_LIMITED (429) when exceeded", async () => {
    const mod = await loadWith({ NODE_ENV: "development" });
    await mod.enforceRateLimit("b", "k1", 1, "10 s");
    const err = await captureError(mod.enforceRateLimit("b", "k1", 1, "10 s"));
    expect(err.name).toBe("RateLimitError");
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.status).toBe(429);
  });
});

describe("checkRateLimit — Upstash configured", () => {
  it("allows when the limiter reports success", async () => {
    const mod = await loadWith(
      { NODE_ENV: "production", VERCEL_ENV: "production", ...UPSTASH },
      async () => ({ success: true, reset: Date.now() + 60_000 }),
    );
    const res = await mod.checkRateLimit("b", "id", 5, "15 m");
    expect(res).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("blocks with a retry hint when the limiter reports failure", async () => {
    const mod = await loadWith(
      { NODE_ENV: "production", VERCEL_ENV: "production", ...UPSTASH },
      async () => ({ success: false, reset: Date.now() + 30_000 }),
    );
    const res = await mod.checkRateLimit("b", "id", 5, "15 m");
    expect(res.allowed).toBe(false);
    expect(res.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("fails OPEN on a transient Upstash error (availability)", async () => {
    const mod = await loadWith(
      { NODE_ENV: "production", VERCEL_ENV: "production", ...UPSTASH },
      async () => {
        throw new Error("redis unreachable");
      },
    );
    const res = await mod.checkRateLimit("b", "id", 5, "15 m");
    expect(res).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("hashEmail", () => {
  it("normalizes case/whitespace and never echoes the address", async () => {
    const mod = await loadWith({ NODE_ENV: "development" });
    const a = mod.hashEmail("  User@Example.com ");
    const b = mod.hashEmail("user@example.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("example");
  });
});
