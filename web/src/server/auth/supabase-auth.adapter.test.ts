import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase server client so updatePassword's error mapping can be
// exercised without a real provider. Node-env test, same pattern as the
// service tests.
vi.mock("@/server/db/supabase", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/server/db/supabase";
import { UnauthorizedError, ValidationError } from "@/server/errors/app-error";

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
});
