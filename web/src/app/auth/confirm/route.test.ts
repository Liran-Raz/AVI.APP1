import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the service so the route's BRANCHING logic is exercised without
// touching Supabase. The route uses exactly these two service functions.
vi.mock("@/server/services/auth.service", () => ({
  exchangeEmailLinkCode: vi.fn(),
  verifyEmailOtp: vi.fn(),
}));

import * as authService from "@/server/services/auth.service";

import { GET } from "./route";

const ORIGIN = "https://www.aviapp1.com";

function get(query: string): Promise<Response> {
  return GET(new Request(`${ORIGIN}/auth/confirm${query}`));
}

function locationOf(res: Response): string {
  return res.headers.get("location") ?? "";
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PKCE `?code=` → exchanges and redirects to `next`", async () => {
    vi.mocked(authService.exchangeEmailLinkCode).mockResolvedValueOnce();

    const res = await get("?code=abc123&next=/reset-password");

    expect(authService.exchangeEmailLinkCode).toHaveBeenCalledWith("abc123");
    expect(authService.verifyEmailOtp).not.toHaveBeenCalled();
    expect(locationOf(res)).toBe(`${ORIGIN}/reset-password`);
  });

  it("OTP `token_hash` + valid type → verifies and redirects to `next`", async () => {
    vi.mocked(authService.verifyEmailOtp).mockResolvedValueOnce();

    const res = await get("?token_hash=xyz&type=recovery&next=/reset-password");

    expect(authService.verifyEmailOtp).toHaveBeenCalledWith({
      tokenHash: "xyz",
      type: "recovery",
    });
    expect(authService.exchangeEmailLinkCode).not.toHaveBeenCalled();
    expect(locationOf(res)).toBe(`${ORIGIN}/reset-password`);
  });

  it("code exchange failure → /login?error=confirm_failed", async () => {
    vi.mocked(authService.exchangeEmailLinkCode).mockRejectedValueOnce(
      new Error("expired code"),
    );

    const res = await get("?code=abc123&next=/reset-password");

    expect(locationOf(res)).toBe(`${ORIGIN}/login?error=confirm_failed`);
  });

  it("OTP verify failure → /login?error=confirm_failed", async () => {
    vi.mocked(authService.verifyEmailOtp).mockRejectedValueOnce(
      new Error("bad otp"),
    );

    const res = await get("?token_hash=xyz&type=recovery");

    expect(locationOf(res)).toBe(`${ORIGIN}/login?error=confirm_failed`);
  });

  it("neither code nor token_hash → confirm_failed, no service call", async () => {
    const res = await get("?next=/reset-password");

    expect(authService.exchangeEmailLinkCode).not.toHaveBeenCalled();
    expect(authService.verifyEmailOtp).not.toHaveBeenCalled();
    expect(locationOf(res)).toBe(`${ORIGIN}/login?error=confirm_failed`);
  });

  it("token_hash with an INVALID type → confirm_failed, no verify call", async () => {
    const res = await get("?token_hash=xyz&type=not_a_real_type");

    expect(authService.verifyEmailOtp).not.toHaveBeenCalled();
    expect(locationOf(res)).toBe(`${ORIGIN}/login?error=confirm_failed`);
  });

  it("defaults to /onboarding when `next` is absent (signup confirm)", async () => {
    vi.mocked(authService.exchangeEmailLinkCode).mockResolvedValueOnce();

    const res = await get("?code=abc123");

    expect(locationOf(res)).toBe(`${ORIGIN}/onboarding`);
  });

  it("rejects an open-redirect `next` (absolute URL) → falls back to /onboarding", async () => {
    vi.mocked(authService.exchangeEmailLinkCode).mockResolvedValueOnce();

    const res = await get("?code=abc123&next=https://evil.example.com");

    expect(locationOf(res)).toBe(`${ORIGIN}/onboarding`);
  });
});
