// Permission catalog, scopes, context types, and per-permission metadata.
//
// This is the single source of truth for *what permissions exist* and
// *what context each requires*. It is intentionally framework-free and
// shared-safe (no `server-only`): the permission KEYS and TYPES may be
// imported by client UI for capability rendering hints. The authoritative
// decision engine (`can` / `requirePermission`) lives in the server-only
// `authorization.ts` and must never be imported by the browser.
//
// Model:
//   - A grant = (permission, recordScope?). Absence of a grant = DENY.
//   - No `none` scope. No explicit deny rules (allow-only).
//   - One action permission per action (no `view_all` / `view_assigned`).
//   - Scope (`all | assigned | own | team`) applies ONLY to record-bearing
//     permissions; office-level capabilities are contextless.
//   - `ownership.transfer` is a PROTECTED system action — NOT a grantable
//     permission (see PROTECTED_ACTIONS) and never appears in any role grant.

import type { UserRole } from "@/server/db/domain.types";

// ============================================================
// Permission catalog
// ============================================================

export const PERMISSIONS = {
  // organizations / settings
  ORGANIZATION_VIEW: "organization.view",
  ORGANIZATION_SETTINGS: "organization.settings",
  ORGANIZATION_DELETE: "organization.delete", // future
  SETTINGS_VIEW: "settings.view",
  SETTINGS_MANAGE: "settings.manage", // future

  // team (roster + membership lifecycle)
  TEAM_VIEW: "team.view",
  TEAM_INVITE: "team.invite",
  TEAM_DEACTIVATE: "team.deactivate",
  TEAM_REACTIVATE: "team.reactivate",
  TEAM_REMOVE: "team.remove", // future
  TEAM_CHANGE_ROLE: "team.change_role",

  // invitations (manage existing)
  INVITATIONS_VIEW: "invitations.view",
  INVITATIONS_REVOKE: "invitations.revoke",
  INVITATIONS_RESEND: "invitations.resend", // future

  // roles (Phase 2 administration)
  ROLES_VIEW: "roles.view",
  ROLES_MANAGE: "roles.manage", // Phase 2

  // clients
  CLIENTS_VIEW: "clients.view",
  CLIENTS_CREATE: "clients.create",
  CLIENTS_EDIT: "clients.edit",
  CLIENTS_ARCHIVE: "clients.archive",
  CLIENTS_RESTORE: "clients.restore",
  CLIENTS_DELETE: "clients.delete", // future
  CLIENTS_EXPORT: "clients.export", // future

  // contacts (scope inherits parent client)
  CONTACTS_VIEW: "contacts.view",
  CONTACTS_CREATE: "contacts.create",
  CONTACTS_EDIT: "contacts.edit",
  CONTACTS_DELETE: "contacts.delete",

  // tasks
  TASKS_VIEW: "tasks.view",
  TASKS_CREATE: "tasks.create",
  TASKS_EDIT: "tasks.edit",
  TASKS_CHANGE_STATUS: "tasks.change_status",
  TASKS_ARCHIVE: "tasks.archive",
  TASKS_DELETE: "tasks.delete",
  TASKS_ASSIGN_SELF: "tasks.assign_self",
  TASKS_ASSIGN_OTHERS: "tasks.assign_others",

  // notifications (inherently self-scoped at the data layer)
  NOTIFICATIONS_VIEW: "notifications.view",
  NOTIFICATIONS_MANAGE: "notifications.manage",

  // billing (future)
  BILLING_VIEW: "billing.view",
  BILLING_MANAGE: "billing.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ============================================================
// Protected, NON-grantable system actions
// ============================================================
//
// Ownership is not an ordinary permission. `ownership.transfer` is owner-only,
// can never be added to any (system or custom) role, and is enforced by a
// dedicated guard (see authorization.ts `canPerformProtectedAction`).

export const PROTECTED_ACTIONS = {
  OWNERSHIP_TRANSFER: "ownership.transfer",
} as const;

export type ProtectedAction =
  (typeof PROTECTED_ACTIONS)[keyof typeof PROTECTED_ACTIONS];

// ============================================================
// Record scopes
// ============================================================

export const RECORD_SCOPES = ["all", "assigned", "own", "team"] as const;
export type RecordScope = (typeof RECORD_SCOPES)[number];

// Scopes that have a backing data model TODAY. `assigned` and `team` require
// a client-assignment model / teams model that do not exist yet, so any grant
// at those scopes DENIES (we never pretend an unsupported scope works).
export const SUPPORTED_RECORD_SCOPES: readonly RecordScope[] = ["all", "own"];

// ============================================================
// Capability (what /api/me exposes to the client as display HINTS)
// ============================================================

export type Capability = {
  permission: Permission;
  recordScope?: RecordScope;
};

// ============================================================
// Permission contexts — built ONLY from server-trusted data
// ============================================================

export type ClientContext = {
  /** org_id of the client, loaded server-side via an org-scoped repo read. */
  orgId: string;
  /** clients.created_by (profiles.id) — null if unknown. Required field. */
  ownerId: string | null;
};

export type ContactContext = {
  /** Contacts have no org_id; authorization inherits the parent client. */
  parentClient: ClientContext;
};

export type TaskContext = {
  orgId: string;
  /** tasks.creator_id (profiles.id) */
  creatorId: string;
  /** tasks.assigned_to (profiles.id) — null if unassigned. Required field. */
  assigneeId: string | null;
};

export type TaskAssignmentContext = {
  /** org_id of the task being assigned. */
  orgId: string;
  /** The user proposed as the new assignee (profiles.id), server-resolved. */
  targetAssigneeId: string;
  /** Whether the target has an ACTIVE membership (server-resolved). */
  targetAssigneeActive: boolean;
  /** The org of the target's membership (server-resolved). */
  targetAssigneeOrgId: string;
};

export type TeamMemberContext = {
  /** The membership being acted on (auth user id / profiles.id). */
  targetUserId: string;
  /** The target member's role in the org (server-resolved). */
  targetRole: UserRole;
  /** The org of the target's membership (server-resolved). */
  targetMembershipOrgId: string;
};

// ============================================================
// Per-permission metadata (single source: context kind + scoping)
// ============================================================

export type ContextKind =
  | "none"
  | "client"
  | "contact"
  | "task"
  | "task_assignment"
  | "team_member";

export type PermissionMeta = {
  /** Which trusted context this permission requires ("none" = contextless). */
  context: ContextKind;
  /** Whether a record scope (all/assigned/own/team) applies to this grant. */
  scoped: boolean;
};

// `as const satisfies` keeps literal types for `ContextFor<P>` AND fails
// compilation if any Permission key is missing or an extra key is present.
export const PERMISSION_META = {
  "organization.view": { context: "none", scoped: false },
  "organization.settings": { context: "none", scoped: false },
  "organization.delete": { context: "none", scoped: false },
  "settings.view": { context: "none", scoped: false },
  "settings.manage": { context: "none", scoped: false },

  "team.view": { context: "none", scoped: false },
  "team.invite": { context: "none", scoped: false },
  "team.deactivate": { context: "team_member", scoped: false },
  "team.reactivate": { context: "team_member", scoped: false },
  "team.remove": { context: "team_member", scoped: false },
  "team.change_role": { context: "team_member", scoped: false },

  "invitations.view": { context: "none", scoped: false },
  "invitations.revoke": { context: "none", scoped: false },
  "invitations.resend": { context: "none", scoped: false },

  "roles.view": { context: "none", scoped: false },
  "roles.manage": { context: "none", scoped: false },

  "clients.view": { context: "client", scoped: true },
  "clients.create": { context: "none", scoped: false },
  "clients.edit": { context: "client", scoped: true },
  "clients.archive": { context: "client", scoped: true },
  "clients.restore": { context: "client", scoped: true },
  "clients.delete": { context: "client", scoped: true },
  "clients.export": { context: "client", scoped: true },

  "contacts.view": { context: "contact", scoped: true },
  "contacts.create": { context: "client", scoped: false },
  "contacts.edit": { context: "contact", scoped: true },
  "contacts.delete": { context: "contact", scoped: true },

  "tasks.view": { context: "task", scoped: true },
  "tasks.create": { context: "none", scoped: false },
  "tasks.edit": { context: "task", scoped: true },
  "tasks.change_status": { context: "task", scoped: true },
  "tasks.archive": { context: "task", scoped: true },
  "tasks.delete": { context: "task", scoped: true },
  "tasks.assign_self": { context: "task_assignment", scoped: false },
  "tasks.assign_others": { context: "task_assignment", scoped: false },

  "notifications.view": { context: "none", scoped: false },
  "notifications.manage": { context: "none", scoped: false },

  "billing.view": { context: "none", scoped: false },
  "billing.manage": { context: "none", scoped: false },
} as const satisfies Record<Permission, PermissionMeta>;

// ============================================================
// Typed context derivation (no drift — derived from PERMISSION_META)
// ============================================================

export type ContextForKind<K extends ContextKind> = K extends "none"
  ? undefined
  : K extends "client"
    ? ClientContext
    : K extends "contact"
      ? ContactContext
      : K extends "task"
        ? TaskContext
        : K extends "task_assignment"
          ? TaskAssignmentContext
          : K extends "team_member"
            ? TeamMemberContext
            : never;

export type ContextFor<P extends Permission> = ContextForKind<
  (typeof PERMISSION_META)[P]["context"]
>;

// Named map the planning doc refers to — derived, so it cannot drift.
export type PermissionContextMap = { [P in Permission]: ContextFor<P> };
