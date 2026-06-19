import { afterEach, describe, expect, it, vi } from "vitest";

import { EmailDeliveryError } from "./email-errors";
import { makeResendEmailAdapter } from "./resend-email.adapter";

// The Resend API key used in tests — assertions check it never leaks into
// any error message.
const API_KEY = "re_super_secret_key_do_not_leak";

const adapter = makeResendEmailAdapter({
  apiKey: API_KEY,
  from: "AVI.APP <noreply@example.test>",
});

const sample = {
  to: "user@example.test",
  subject: "Hello",
  text: "Body",
  html: "<p>Body</p>",
};

// Minimal fetch Response stand-in (the adapter only touches ok/status/
// statusText/text). Avoids depending on a global Response constructor.
function fakeResponse(opts: {
  status: number;
  statusText?: string;
  body?: string;
}): Response {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    statusText: opts.statusText ?? "",
    text: async () => opts.body ?? "",
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resend email adapter", () => {
  it("resolves and calls the Resend API when the provider returns 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(adapter.send(sample)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
  });

  it("throws EmailDeliveryError (never success) when the provider returns an error status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        status: 422,
        statusText: "Unprocessable Entity",
        body: '{"name":"validation_error","message":"bad from"}',
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const err = await captureError(adapter.send(sample));
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect((err as EmailDeliveryError).status).toBe(422);
    expect(err.message).toContain("422");
  });

  it("throws (does not swallow) when fetch itself throws", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED 1.2.3.4:443"));
    vi.stubGlobal("fetch", fetchMock);

    const err = await captureError(adapter.send(sample));
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect(err.message).toContain("ECONNREFUSED");
  });

  it("never includes the API key in the error message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        status: 401,
        statusText: "Unauthorized",
        body: "API key is invalid",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const err = await captureError(adapter.send(sample));
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect(err.message).not.toContain(API_KEY);
  });

  it("caps an oversized provider body in the error message", async () => {
    const huge = "x".repeat(5000);
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        status: 500,
        statusText: "Internal Server Error",
        body: huge,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const err = await captureError(adapter.send(sample));
    expect(err.message.length).toBeLessThan(500);
  });
});
