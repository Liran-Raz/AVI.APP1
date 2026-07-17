import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the adapter boundary (same convention as the other service tests) —
// the service logic under test is real.
vi.mock("@/server/auth/supabase-auth.adapter", () => ({
  authAdapter: {
    signIn: vi.fn(),
    verifyPassword: vi.fn(),
    updatePassword: vi.fn(),
    listTotpFactors: vi.fn(),
    enrollTotp: vi.fn(),
    verifyTotp: vi.fn(),
    unenrollFactor: vi.fn(),
  },
}));
vi.mock("@/server/env", () => ({
  env: { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" },
}));

import { authAdapter } from "@/server/auth/supabase-auth.adapter";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors/app-error";

import * as authService from "./auth.service";

const signInMock = vi.mocked(authAdapter.signIn);
const verifyPasswordMock = vi.mocked(authAdapter.verifyPassword);
const updatePasswordMock = vi.mocked(authAdapter.updatePassword);
const listFactorsMock = vi.mocked(authAdapter.listTotpFactors);
const enrollMock = vi.mocked(authAdapter.enrollTotp);
const verifyTotpMock = vi.mocked(authAdapter.verifyTotp);
const unenrollMock = vi.mocked(authAdapter.unenrollFactor);

function authUser(hasVerifiedTotp: boolean) {
  return {
    id: "user-1",
    email: "u@e.t",
    emailConfirmedAt: null,
    metadata: {},
    hasVerifiedTotp,
  };
}

const verifiedFactor = {
  id: "f-verified",
  friendlyName: "AVI.APP",
  status: "verified" as const,
  createdAt: null,
};
const unverifiedFactor = {
  id: "f-stale",
  friendlyName: "AVI.APP",
  status: "unverified" as const,
  createdAt: null,
};

async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth.service.signIn — needsMfa (DEV-013)", () => {
  it("enrolled user → needsMfa true (password sign-in is always aal1)", async () => {
    signInMock.mockResolvedValue(authUser(true));
    const result = await authService.signIn({ email: "u@e.t", password: "pw" });
    expect(result.needsMfa).toBe(true);
  });

  it("non-enrolled user → needsMfa false", async () => {
    signInMock.mockResolvedValue(authUser(false));
    const result = await authService.signIn({ email: "u@e.t", password: "pw" });
    expect(result.needsMfa).toBe(false);
  });
});

describe("auth.service.changePassword — throwaway re-auth (DEV-013 F1)", () => {
  it("verifies via verifyPassword (NOT signIn) then updates", async () => {
    verifyPasswordMock.mockResolvedValue(undefined);
    updatePasswordMock.mockResolvedValue(undefined);

    await authService.changePassword({
      email: "u@e.t",
      currentPassword: "old",
      newPassword: "newPassword1",
    });

    expect(verifyPasswordMock).toHaveBeenCalledWith({
      email: "u@e.t",
      password: "old",
    });
    // The cookie-session sign-in must NOT run — it would downgrade an
    // aal2 session and the provider would then refuse the update.
    expect(signInMock).not.toHaveBeenCalled();
    expect(updatePasswordMock).toHaveBeenCalledWith({
      password: "newPassword1",
    });
  });

  it("wrong current password → ValidationError{wrong_current_password}", async () => {
    verifyPasswordMock.mockRejectedValue(new UnauthorizedError());
    const err = await captureError(
      authService.changePassword({
        email: "u@e.t",
        currentPassword: "bad",
        newPassword: "newPassword1",
      }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toEqual({
      reason: "wrong_current_password",
    });
    expect(updatePasswordMock).not.toHaveBeenCalled();
  });
});

describe("auth.service TOTP flows (DEV-013)", () => {
  it("startTotpEnrollment cleans ONLY stale unverified factors, then enrolls", async () => {
    listFactorsMock.mockResolvedValue([verifiedFactor, unverifiedFactor]);
    enrollMock.mockResolvedValue({
      factorId: "f-new",
      qrCode: "data:image/svg+xml;utf-8,<svg/>",
      secret: "SECRET",
    });

    const result = await authService.startTotpEnrollment();

    expect(unenrollMock).toHaveBeenCalledTimes(1);
    expect(unenrollMock).toHaveBeenCalledWith("f-stale");
    expect(enrollMock).toHaveBeenCalledWith({
      issuer: "AVI.APP",
      friendlyName: "AVI.APP",
    });
    expect(result.factorId).toBe("f-new");
  });

  it("verifyMfaChallenge targets the VERIFIED factor", async () => {
    listFactorsMock.mockResolvedValue([unverifiedFactor, verifiedFactor]);
    verifyTotpMock.mockResolvedValue(undefined);

    await authService.verifyMfaChallenge({ code: "123456" });

    expect(verifyTotpMock).toHaveBeenCalledWith({
      factorId: "f-verified",
      code: "123456",
    });
  });

  it("verifyMfaChallenge without a verified factor → ValidationError{no_verified_factor}", async () => {
    listFactorsMock.mockResolvedValue([unverifiedFactor]);
    const err = await captureError(
      authService.verifyMfaChallenge({ code: "123456" }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toEqual({
      reason: "no_verified_factor",
    });
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });

  it("disableTotp removes every TOTP factor (verified + stale)", async () => {
    listFactorsMock.mockResolvedValue([verifiedFactor, unverifiedFactor]);
    unenrollMock.mockResolvedValue(undefined);

    await authService.disableTotp();

    expect(unenrollMock).toHaveBeenCalledTimes(2);
    expect(unenrollMock).toHaveBeenCalledWith("f-verified");
    expect(unenrollMock).toHaveBeenCalledWith("f-stale");
  });

  it("disableTotp with nothing verified → NotFoundError (nothing removed)", async () => {
    listFactorsMock.mockResolvedValue([unverifiedFactor]);
    const err = await captureError(authService.disableTotp());
    expect(err).toBeInstanceOf(NotFoundError);
    expect(unenrollMock).not.toHaveBeenCalled();
  });
});
