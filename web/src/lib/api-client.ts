// Internal API client. Client components call THIS, not Supabase.
// One source of truth for talking to /api/* — request shape, response
// shape, and error handling are all here.
//
// Note: this file is intentionally provider-agnostic. It must not import
// from @supabase/* or @/server/* values (types only).

import type {
  SigninPayload,
  SignupPayload,
} from "@/server/validators/auth.schema";
import type { BootstrapOrgPayload } from "@/server/validators/onboarding.schema";

// ============================================================
// Response payloads — match what each /api route actually returns
// ============================================================

export type AuthOperationResult = {
  userId: string;
  email: string;
  needsEmailConfirmation: boolean;
};

export type BootstrapOrgResult = {
  orgId: string;
  created: boolean;
};

export type MeRole = "owner" | "admin" | "employee";

export type Me = {
  user: { id: string; email: string | null };
  profile: { fullName: string; role: MeRole } | null;
  organization: { id: string; name: string; orgCode: string } | null;
};

// ============================================================
// Error type clients can switch on
// ============================================================

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ============================================================
// Internal envelope
// ============================================================

type ApiSuccess<T> = { success: true; data: T };
type ApiFailure = {
  success: false;
  error: { code: string; message: string; details?: unknown };
};

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
    });
  } catch (e) {
    throw new ApiError(
      "NETWORK_ERROR",
      "Network error",
      0,
      e instanceof Error ? e.message : String(e),
    );
  }

  let payload: ApiSuccess<T> | ApiFailure | null = null;
  try {
    payload = (await res.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    // Non-JSON response
  }

  if (!payload || typeof payload !== "object" || !("success" in payload)) {
    throw new ApiError("INTERNAL_ERROR", "Unexpected response", res.status);
  }
  if (!payload.success) {
    throw new ApiError(
      payload.error.code,
      payload.error.message,
      res.status,
      payload.error.details,
    );
  }
  return payload.data;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return call<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function getJson<T>(path: string): Promise<T> {
  return call<T>(path, { method: "GET" });
}

// ============================================================
// Public surface
// ============================================================

export const apiClient = {
  auth: {
    signIn: (input: SigninPayload) =>
      postJson<AuthOperationResult>("/api/auth/signin", input),
    signUp: (input: SignupPayload) =>
      postJson<AuthOperationResult>("/api/auth/signup", input),
    signOut: () => postJson<null>("/api/auth/signout"),
  },
  onboarding: {
    bootstrap: (input: BootstrapOrgPayload) =>
      postJson<BootstrapOrgResult>("/api/onboarding/bootstrap", input),
  },
  me: {
    get: () => getJson<Me>("/api/me"),
  },
};
