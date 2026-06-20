// Internal API client. Client components call THIS, not Supabase.
// One source of truth for talking to /api/* — request shape, response
// shape, and error handling are all here.
//
// Note: this file is intentionally provider-agnostic. It must not import
// from @supabase/* or @/server/* values (types only).

import type {
  ForgotPasswordPayload,
  ResetPasswordPayload,
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
import type {
  CreateContactPayload,
  UpdateContactPayload,
} from "@/server/validators/client-contacts.schema";
import type { ContactDTO } from "@/server/services/client-contacts.service";
import type { Capability } from "@/server/auth/permissions";
import type { NotificationDTO } from "@/server/services/notifications.service";
import type {
  AcceptInvitationDTO,
  InvitationDTO,
  MemberDTO,
} from "@/server/services/team.service";
import type {
  AcceptInvitationPayload,
  ChangeRolePayload,
  InvitePayload,
  InviteSignupPayload,
} from "@/server/validators/team.schema";

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

export type { ContactDTO } from "@/server/services/client-contacts.service";
export type {
  CreateContactPayload,
  UpdateContactPayload,
} from "@/server/validators/client-contacts.schema";

export type { NotificationDTO } from "@/server/services/notifications.service";

export type {
  MemberDTO,
  InvitationDTO,
  AcceptInvitationDTO,
} from "@/server/services/team.service";
export type {
  InvitePayload,
  ChangeRolePayload,
  AcceptInvitationPayload,
  InviteSignupPayload,
  AssignableRole,
} from "@/server/validators/team.schema";

// ============================================================
// Response payloads — match what each /api route actually returns
// ============================================================

export type AuthOperationResult = {
  userId: string;
  email: string;
  needsEmailConfirmation: boolean;
};

// Public signup response — intentionally omits userId so an
// already-registered email is indistinguishable from a fresh signup
// (anti-enumeration). The client only needs needsEmailConfirmation + email.
export type SignUpResponse = {
  email: string;
  needsEmailConfirmation: boolean;
};

export type BootstrapOrgResult = {
  orgId: string;
  created: boolean;
};

export type MeRole = "owner" | "admin" | "employee";

// One office the user belongs to (active memberships only). Drives the
// office switcher. `role` is the caller's role IN that office.
export type MembershipSummary = {
  orgId: string;
  name: string;
  orgCode: string;
  role: MeRole;
  isActive: boolean;
};

export type Me = {
  user: { id: string; email: string | null };
  profile: { fullName: string; role: MeRole } | null;
  // The ACTIVE office (backward-compatible field name).
  organization: { id: string; name: string; orgCode: string } | null;
  memberships: MembershipSummary[];
  activeOrgId: string | null;
  // Display-only authorization hints for the active office (never authoritative).
  capabilities: Capability[];
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

function deleteJson<T>(path: string): Promise<T> {
  return call<T>(path, { method: "DELETE" });
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
      postJson<SignUpResponse>("/api/auth/signup", input),
    signOut: () => postJson<null>("/api/auth/signout"),
    // Begin a Google OAuth flow. Returns the URL the browser should
    // navigate to (window.location.assign). Cookies for PKCE/state are
    // already set by the server response, so the subsequent /auth/callback
    // can complete the exchange.
    startOAuthGoogle: (input?: { redirect?: string }) =>
      postJson<StartOAuthResult>("/api/auth/oauth/google", input ?? {}),
    // Request a password-reset email. The server ALWAYS returns success
    // regardless of whether the email matches a real user — do not
    // surface variance back to the user.
    requestPasswordReset: (input: ForgotPasswordPayload) =>
      postJson<null>("/api/auth/forgot-password", input),
    // Set a new password for the currently-authenticated user. Requires
    // an active session — typically the recovery session set by clicking
    // the email link. Sends both password + confirmPassword; the server
    // re-validates the match.
    resetPassword: (input: ResetPasswordPayload) =>
      postJson<null>("/api/auth/reset-password", input),
  },
  onboarding: {
    bootstrap: (input: BootstrapOrgPayload) =>
      postJson<BootstrapOrgResult>("/api/onboarding/bootstrap", input),
  },
  me: {
    get: () => getJson<Me>("/api/me"),
    // Switch the active office. Server validates an active membership in
    // the target org before writing the cookie. Caller should
    // router.refresh() afterwards so server components re-render in scope.
    setActiveOrg: (orgId: string) =>
      postJson<{ activeOrgId: string }>("/api/me/active-org", { orgId }),
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
  clientContacts: {
    list: (clientId: string) =>
      getJson<{ items: ContactDTO[] }>(
        `/api/clients/${clientId}/contacts`,
      ),
    get: (clientId: string, contactId: string) =>
      getJson<ContactDTO>(
        `/api/clients/${clientId}/contacts/${contactId}`,
      ),
    create: (clientId: string, input: CreateContactPayload) =>
      postJson<ContactDTO>(`/api/clients/${clientId}/contacts`, input),
    update: (
      clientId: string,
      contactId: string,
      patch: UpdateContactPayload,
    ) =>
      patchJson<ContactDTO>(
        `/api/clients/${clientId}/contacts/${contactId}`,
        patch,
      ),
    delete: (clientId: string, contactId: string) =>
      deleteJson<{ deleted: true }>(
        `/api/clients/${clientId}/contacts/${contactId}`,
      ),
  },
  notifications: {
    list: (params?: { unreadOnly?: boolean; limit?: number }) =>
      getJson<{ items: NotificationDTO[]; unreadCount: number }>(
        `/api/notifications${toQueryString(params ?? {})}`,
      ),
    unreadCount: () =>
      getJson<{ count: number }>("/api/notifications/unread-count"),
    markRead: (id: string) =>
      postJson<{ id: string; alreadyRead: boolean }>(
        `/api/notifications/${id}/read`,
      ),
    markAllRead: () =>
      postJson<{ updatedCount: number }>("/api/notifications/read-all"),
  },
  team: {
    list: () => getJson<{ items: MemberDTO[] }>("/api/team"),
    // Create a new invitation. The response includes `inviteUrl` so
    // admins can copy-paste the link (useful when Resend is not
    // configured and the email service is in console-fallback mode).
    invite: (input: InvitePayload) =>
      postJson<InvitationDTO>("/api/team/invitations", input),
    changeRole: (memberId: string, input: ChangeRolePayload) =>
      patchJson<MemberDTO>(
        `/api/team/members/${memberId}/role`,
        input,
      ),
    deactivate: (memberId: string) =>
      postJson<MemberDTO>(`/api/team/members/${memberId}/deactivate`),
  },
  invite: {
    // Accept a pending invitation. The caller must have an active
    // session (the API enforces it). On success the user has a profile
    // in the inviter's org.
    accept: (input: AcceptInvitationPayload) =>
      postJson<AcceptInvitationDTO>("/api/invite/accept", input),
    // Dedicated signup flow for invited users — see /api/invite/signup.
    signup: (input: InviteSignupPayload) =>
      postJson<AuthOperationResult>("/api/invite/signup", input),
  },
};
