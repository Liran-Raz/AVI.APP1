import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tests the adapter SELECTION logic in email.ts across environments.
// getEmailAdapter() caches its result, so each scenario resets the module
// registry and re-imports a fresh copy with the desired env.

const ENV_KEYS = ["RESEND_API_KEY", "MAIL_FROM", "NODE_ENV"] as const;
const PROD = "production";
const DEV = "development";

const message = { to: "a@b.test", subject: "s", text: "t" };

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function fakeResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    text: async () => "",
  } as unknown as Response;
}

// Await a promise that must reject and return the thrown Error (typed).
async function captureError(p: Promise<unknown>): Promise<Error> {
  let captured: unknown;
  let threw = false;
  try {
    await p;
  } catch (e) {
    threw = true;
    captured = e;
  }
  if (!threw) throw new Error("Expected promise to reject, but it resolved");
  return captured as Error;
}

async function resolveAdapterWith(env: {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  NODE_ENV: string;
}) {
  setEnv("RESEND_API_KEY", env.RESEND_API_KEY);
  setEnv("MAIL_FROM", env.MAIL_FROM);
  setEnv("NODE_ENV", env.NODE_ENV);
  vi.resetModules();
  const mod = await import("./email");
  return mod.getEmailAdapter();
}

let saved: Record<string, string | undefined>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // Keep selection logs out of the test output while still asserting on them.
  vi.spyOn(console, "info").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("getEmailAdapter — provider configured", () => {
  it("uses the Resend adapter (hits the Resend API) when both keys are set, even in production", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = await resolveAdapterWith({
      RESEND_API_KEY: "re_live_key",
      MAIL_FROM: "AVI.APP <noreply@example.test>",
      NODE_ENV: PROD,
    });
    await adapter.send(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
  });
});

describe("getEmailAdapter — production must FAIL LOUD, never silently no-op", () => {
  it("missing RESEND_API_KEY in production → send() throws (no false success, no provider call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = await resolveAdapterWith({
      RESEND_API_KEY: undefined,
      MAIL_FROM: "AVI.APP <noreply@example.test>",
      NODE_ENV: PROD,
    });

    const err = await captureError(adapter.send(message));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("EmailConfigError");
    // Proves the no-op console adapter was NOT selected and Resend was not called.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("empty/whitespace RESEND_API_KEY in production → send() throws", async () => {
    const adapter = await resolveAdapterWith({
      RESEND_API_KEY: "   ",
      MAIL_FROM: "AVI.APP <noreply@example.test>",
      NODE_ENV: PROD,
    });
    const err = await captureError(adapter.send(message));
    expect(err.name).toBe("EmailConfigError");
  });

  it("missing MAIL_FROM in production → send() throws", async () => {
    const adapter = await resolveAdapterWith({
      RESEND_API_KEY: "re_live_key",
      MAIL_FROM: undefined,
      NODE_ENV: PROD,
    });
    const err = await captureError(adapter.send(message));
    expect(err.name).toBe("EmailConfigError");
  });

  it("empty MAIL_FROM in production → send() throws", async () => {
    const adapter = await resolveAdapterWith({
      RESEND_API_KEY: "re_live_key",
      MAIL_FROM: "",
      NODE_ENV: PROD,
    });
    const err = await captureError(adapter.send(message));
    expect(err.name).toBe("EmailConfigError");
  });

  it("logs a loud error (without leaking secrets) when production email is unconfigured", async () => {
    await resolveAdapterWith({
      RESEND_API_KEY: undefined,
      MAIL_FROM: undefined,
      NODE_ENV: PROD,
    });
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls
      .map((c: unknown[]) => JSON.stringify(c))
      .join(" ");
    expect(logged).not.toContain("re_live_key");
  });
});

describe("getEmailAdapter — development fallback is explicit and environment-gated", () => {
  it("missing config in development → console adapter (send resolves, no provider call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = await resolveAdapterWith({
      RESEND_API_KEY: undefined,
      MAIL_FROM: undefined,
      NODE_ENV: DEV,
    });

    await expect(adapter.send(message)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("identical missing config behaves differently by environment: dev resolves, prod throws", async () => {
    const devAdapter = await resolveAdapterWith({ NODE_ENV: DEV });
    await expect(devAdapter.send(message)).resolves.toBeUndefined();

    const prodAdapter = await resolveAdapterWith({ NODE_ENV: PROD });
    const err = await captureError(prodAdapter.send(message));
    expect(err.name).toBe("EmailConfigError");
  });
});
