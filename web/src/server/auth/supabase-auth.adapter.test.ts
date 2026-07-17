import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase server client so updatePassword's error mapping can be
// exercised without a real provider. Node-env test, same pattern as the
// service tests.
vi.mock("@/server/db/supabase", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseStatelessAuthClient: vi.fn(),
}));

import {
  createSupabaseServerClient,
  createSupabaseStatelessAuthClient,
} from "@/server/db/supabase";
import {
  MfaRequiredError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors/app-error";

import { authAdapter } from "./supabase-auth.adapter";

type UpdateUserError = { status?: number; code?: string; message: string };

function mockUpdateUser(result: { error: UpdateUserError | null }) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { updateUser: vi.fn().mockResolvedValue(result) },
  } as never);
}

async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

describe("SupabaseAuthAdapter.updatePassword — same-password mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves when the provider reports no error", async () => {
    mockUpdateUser({ error: null });
    await expect(
      authAdapter.updatePassword({ password: "brandNewPass123" }),
    ).resolves.toBeUndefined();
  });

  it("tags same_password (by provider code) with details.reason", async () => {
    mockUpdateUser({
      error: {
        status: 422,
        code: "same_password",
        message: "New password should be different from the old password.",
      },
    });
    const err = await captureError(
      authAdapter.updatePassword({ password: "theOldPassword1" }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toEqual({
      reason: "same_password",
    });
  });

  it("tags same_password (by message) even without a provider code", async () => {
    mockUpdateUser({
      error: {
        status: 422,
        message: "New password should be different from the old password.",
      },
    });
    const err = await captureError(
      authAdapter.updatePassword({ password: "theOldPassword1" }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toEqual({
      reason: "same_password",
    });
  });

  it("leaves OTHER 422 errors without the same_password reason", async () => {
    mockUpdateUser({
      error: { status: 422, code: "weak_password", message: "Password is too weak" },
    });
    const err = await captureError(
      authAdapter.updatePassword({ password: "weak" }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toBeUndefined();
  });

  it("maps 401 to UnauthorizedError (expired/missing recovery session)", async () => {
    mockUpdateUser({
      error: { status: 401, message: "Auth session missing" },
    });
    const err = await captureError(
      authAdapter.updatePassword({ password: "brandNewPass123" }),
    );
    expect(err).toBeInstanceOf(UnauthorizedError);
  });

  it("maps the provider's aal2 refusal to MfaRequiredError (by code)", async () => {
    mockUpdateUser({
      error: { status: 403, code: "insufficient_aal", message: "AAL2 required" },
    });
    const err = await captureError(
      authAdapter.updatePassword({ password: "brandNewPass123" }),
    );
    expect(err).toBeInstanceOf(MfaRequiredError);
  });

  it("maps the provider's aal2 refusal to MfaRequiredError (by message)", async () => {
    mockUpdateUser({
      error: {
        status: 401,
        message:
          "AAL2 session is required to update email or password when MFA is enabled",
      },
    });
    const err = await captureError(
      authAdapter.updatePassword({ password: "brandNewPass123" }),
    );
    expect(err).toBeInstanceOf(MfaRequiredError);
  });
});

// ============================================================
// MFA (TOTP) — DEV-013
// ============================================================

type MfaSurface = {
  getUser?: ReturnType<typeof vi.fn>;
  getAuthenticatorAssuranceLevel?: ReturnType<typeof vi.fn>;
  listFactors?: ReturnType<typeof vi.fn>;
  enroll?: ReturnType<typeof vi.fn>;
  challengeAndVerify?: ReturnType<typeof vi.fn>;
  unenroll?: ReturnType<typeof vi.fn>;
};

function mockMfaClient(surface: MfaSurface) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: surface.getUser ?? vi.fn(),
      mfa: {
        getAuthenticatorAssuranceLevel:
          surface.getAuthenticatorAssuranceLevel ?? vi.fn(),
        listFactors: surface.listFactors ?? vi.fn(),
        enroll: surface.enroll ?? vi.fn(),
        challengeAndVerify: surface.challengeAndVerify ?? vi.fn(),
        unenroll: surface.unenroll ?? vi.fn(),
      },
    },
  } as never);
}

const verifiedTotpUser = {
  id: "user-1",
  email: "u@e.t",
  factors: [{ id: "f-1", factor_type: "totp", status: "verified" }],
};

describe("SupabaseAuthAdapter.getCurrentUserWithMfa (DEV-013)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enrolled + aal1 session → mfaPending true, order getUser → AAL", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: verifiedTotpUser },
      error: null,
    });
    const getAal = vi.fn().mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    mockMfaClient({ getUser, getAuthenticatorAssuranceLevel: getAal });

    const result = await authAdapter.getCurrentUserWithMfa();
    expect(result).toMatchObject({
      currentLevel: "aal1",
      mfaPending: true,
      user: { id: "user-1", hasVerifiedTotp: true },
    });
    // Load-bearing order (F2): the network-verified getUser must run
    // BEFORE the local AAL decode on the same client.
    expect(getUser.mock.invocationCallOrder[0]).toBeLessThan(
      getAal.mock.invocationCallOrder[0],
    );
  });

  it("enrolled + aal2 session → mfaPending false", async () => {
    mockMfaClient({
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: verifiedTotpUser }, error: null }),
      getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
        data: { currentLevel: "aal2", nextLevel: "aal2" },
        error: null,
      }),
    });
    const result = await authAdapter.getCurrentUserWithMfa();
    expect(result?.mfaPending).toBe(false);
    expect(result?.currentLevel).toBe("aal2");
  });

  it("NOT enrolled (unverified factor only) → mfaPending false", async () => {
    mockMfaClient({
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "user-1",
            factors: [{ id: "f-2", factor_type: "totp", status: "unverified" }],
          },
        },
        error: null,
      }),
      getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
        data: { currentLevel: "aal1", nextLevel: "aal1" },
        error: null,
      }),
    });
    const result = await authAdapter.getCurrentUserWithMfa();
    expect(result?.user.hasVerifiedTotp).toBe(false);
    expect(result?.mfaPending).toBe(false);
  });

  it("no user → null", async () => {
    mockMfaClient({
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: null }, error: { message: "x" } }),
    });
    expect(await authAdapter.getCurrentUserWithMfa()).toBeNull();
  });

  it("AAL read fails for an enrolled user → FAIL CLOSED (pending true)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockMfaClient({
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: verifiedTotpUser }, error: null }),
      getAuthenticatorAssuranceLevel: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "boom" } }),
    });
    const result = await authAdapter.getCurrentUserWithMfa();
    expect(result?.currentLevel).toBeNull();
    expect(result?.mfaPending).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("SupabaseAuthAdapter TOTP methods (DEV-013)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("verifyTotp: provider verification failure → ValidationError{invalid_code}", async () => {
    mockMfaClient({
      challengeAndVerify: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 422, code: "mfa_verification_failed", message: "bad" },
      }),
    });
    const err = await captureError(
      authAdapter.verifyTotp({ factorId: "f-1", code: "123456" }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toEqual({ reason: "invalid_code" });
  });

  it("verifyTotp: unknown factor → NotFoundError", async () => {
    mockMfaClient({
      challengeAndVerify: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 404, code: "mfa_factor_not_found", message: "nope" },
      }),
    });
    const err = await captureError(
      authAdapter.verifyTotp({ factorId: "f-x", code: "123456" }),
    );
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("verifyTotp: provider 429 → RateLimitError", async () => {
    mockMfaClient({
      challengeAndVerify: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 429, message: "too many" },
      }),
    });
    const err = await captureError(
      authAdapter.verifyTotp({ factorId: "f-1", code: "123456" }),
    );
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it("unenrollFactor: insufficient_aal → MfaRequiredError", async () => {
    mockMfaClient({
      unenroll: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 403, code: "insufficient_aal", message: "aal2" },
      }),
    });
    const err = await captureError(authAdapter.unenrollFactor("f-1"));
    expect(err).toBeInstanceOf(MfaRequiredError);
  });

  it("enrollTotp: success returns factorId + qrCode + secret", async () => {
    mockMfaClient({
      enroll: vi.fn().mockResolvedValue({
        data: {
          id: "f-9",
          type: "totp",
          totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "SECRET" },
        },
        error: null,
      }),
    });
    await expect(
      authAdapter.enrollTotp({ issuer: "AVI.APP", friendlyName: "AVI.APP" }),
    ).resolves.toEqual({
      factorId: "f-9",
      qrCode: "data:image/svg+xml;utf-8,<svg/>",
      secret: "SECRET",
    });
  });

  it("enrollTotp: verified factor already exists → ValidationError{already_enrolled}", async () => {
    mockMfaClient({
      enroll: vi.fn().mockResolvedValue({
        data: null,
        error: {
          status: 422,
          code: "mfa_verified_factor_exists",
          message: "exists",
        },
      }),
    });
    const err = await captureError(
      authAdapter.enrollTotp({ issuer: "AVI.APP", friendlyName: "AVI.APP" }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toEqual({
      reason: "already_enrolled",
    });
  });

  it("listTotpFactors: keeps only totp factors, maps statuses", async () => {
    mockMfaClient({
      listFactors: vi.fn().mockResolvedValue({
        data: {
          all: [
            { id: "t1", factor_type: "totp", status: "verified", friendly_name: "AVI.APP" },
            { id: "t2", factor_type: "totp", status: "unverified" },
            { id: "p1", factor_type: "phone", status: "verified" },
          ],
        },
        error: null,
      }),
    });
    const factors = await authAdapter.listTotpFactors();
    expect(factors.map((f) => f.id)).toEqual(["t1", "t2"]);
    expect(factors[0].status).toBe("verified");
    expect(factors[1].status).toBe("unverified");
  });
});

describe("SupabaseAuthAdapter.verifyPassword (DEV-013)", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockStateless(surface: {
    signInWithPassword: ReturnType<typeof vi.fn>;
    signOut?: ReturnType<typeof vi.fn>;
  }) {
    vi.mocked(createSupabaseStatelessAuthClient).mockReturnValue({
      auth: {
        signInWithPassword: surface.signInWithPassword,
        signOut: surface.signOut ?? vi.fn().mockResolvedValue({ error: null }),
      },
    } as never);
  }

  it("verifies on the STATELESS client only and signs out with scope local", async () => {
    const signIn = vi.fn().mockResolvedValue({ data: {}, error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    mockStateless({ signInWithPassword: signIn, signOut });

    await authAdapter.verifyPassword({ email: "u@e.t", password: "pw" });

    expect(signIn).toHaveBeenCalledWith({ email: "u@e.t", password: "pw" });
    // The cookie-bound client must never be touched (it would replace the
    // caller's session and downgrade aal2 → aal1).
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    // Scope MUST be local — global would revoke the user's REAL sessions.
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("wrong password (400) → UnauthorizedError", async () => {
    mockStateless({
      signInWithPassword: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 400, message: "Invalid login credentials" },
      }),
    });
    const err = await captureError(
      authAdapter.verifyPassword({ email: "u@e.t", password: "wrong" }),
    );
    expect(err).toBeInstanceOf(UnauthorizedError);
  });
});
