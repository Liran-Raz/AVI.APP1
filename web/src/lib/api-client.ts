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
import type {
  CreateClientPayload,
  ListClientsQuery,
  UpdateClientPayload,
} from "@/server/validators/clients.schema";
import type { ClientDTO } from "@/server/services/clients.service";
import type {
  CreateTaskPayload,
  ListTasksQuery,
  StatusTransitionPayload,
  UpdateTaskPayload,
} from "@/server/validators/tasks.schema";
import type { TaskDTO } from "@/server/services/tasks.service";

// Re-export DTOs so client components have one stable import path.
export type { ClientDTO } from "@/server/services/clients.service";
export type {
  CreateClientPayload,
  UpdateClientPayload,
  ListClientsQuery,
} from "@/server/validators/clients.schema";
export { BUSINESS_TYPES } from "@/server/validators/clients.schema";

export type { TaskDTO } from "@/server/services/tasks.service";
export type {
  CreateTaskPayload,
  UpdateTaskPayload,
  ListTasksQuery,
  StatusTransitionPayload,
  TaskStatusValue,
  TaskPriorityValue,
  LifecycleFilter,
} from "@/server/validators/tasks.schema";
export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  LIFECYCLE_FILTERS,
} from "@/server/validators/tasks.schema";

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

function patchJson<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function getJson<T>(path: string): Promise<T> {
  return call<T>(path, { method: "GET" });
}

function toQueryString(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ============================================================
// Public surface
// ============================================================

export type StartOAuthResult = { url: string };

export const apiClient = {
  auth: {
    signIn: (input: SigninPayload) =>
      postJson<AuthOperationResult>("/api/auth/signin", input),
    signUp: (input: SignupPayload) =>
      postJson<AuthOperationResult>("/api/auth/signup", input),
    signOut: () => postJson<null>("/api/auth/signout"),
    // Begin a Google OAuth flow. Returns the URL the browser should
    // navigate to (window.location.assign). Cookies for PKCE/state are
    // already set by the server response, so the subsequent /auth/callback
    // can complete the exchange.
    startOAuthGoogle: (input?: { redirect?: string }) =>
      postJson<StartOAuthResult>("/api/auth/oauth/google", input ?? {}),
  },
  onboarding: {
    bootstrap: (input: BootstrapOrgPayload) =>
      postJson<BootstrapOrgResult>("/api/onboarding/bootstrap", input),
  },
  me: {
    get: () => getJson<Me>("/api/me"),
  },
  clients: {
    list: (query?: Partial<ListClientsQuery>) =>
      getJson<{ items: ClientDTO[] }>(
        `/api/clients${toQueryString(query ?? {})}`,
      ),
    get: (id: string) => getJson<ClientDTO>(`/api/clients/${id}`),
    create: (input: CreateClientPayload) =>
      postJson<ClientDTO>("/api/clients", input),
    update: (id: string, patch: UpdateClientPayload) =>
      patchJson<ClientDTO>(`/api/clients/${id}`, patch),
    archive: (id: string) =>
      postJson<ClientDTO>(`/api/clients/${id}/archive`),
    restore: (id: string) =>
      postJson<ClientDTO>(`/api/clients/${id}/restore`),
  },
  tasks: {
    list: (query?: Partial<ListTasksQuery>) => {
      // `status` is an array on the backend — encode as CSV in the URL.
      const params: Record<string, unknown> = { ...(query ?? {}) };
      if (Array.isArray(params.status)) {
        params.status = params.status.join(",");
      }
      return getJson<{ items: TaskDTO[] }>(
        `/api/tasks${toQueryString(params)}`,
      );
    },
    get: (id: string) => getJson<TaskDTO>(`/api/tasks/${id}`),
    create: (input: CreateTaskPayload) =>
      postJson<TaskDTO>("/api/tasks", input),
    update: (id: string, patch: UpdateTaskPayload) =>
      patchJson<TaskDTO>(`/api/tasks/${id}`, patch),
    setStatus: (id: string, payload: StatusTransitionPayload) =>
      postJson<TaskDTO>(`/api/tasks/${id}/status`, payload),
    archive: (id: string) =>
      postJson<TaskDTO>(`/api/tasks/${id}/archive`),
    unarchive: (id: string) =>
      postJson<TaskDTO>(`/api/tasks/${id}/unarchive`),
    delete: (id: string) =>
      postJson<TaskDTO>(`/api/tasks/${id}/delete`),
    restore: (id: string) =>
      postJson<TaskDTO>(`/api/tasks/${id}/restore`),
  },
};
