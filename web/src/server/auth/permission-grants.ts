// Default role → permission grant map (Phase 1, code-defined).
//
// A grant value is either a RecordScope (for record-scoped permissions) or
// `true` (for contextless / capability permissions). **Absence of a key =
// DENY.** This map mirrors the CURRENT behavior so wiring it in later stages
// is behavior-preserving, except for the intentional, separately-gated change
// to `contacts.delete` (Owner/Manager only — applied when Clients & Contacts
// are migrated, not here).
//
// Role keys are the EXISTING DB role keys for compatibility:
//   owner    → Owner
//   admin    → Manager (product label; internal key stays `admin` for now)
//   employee → Employee
//
// `ownership.transfer` is a protected action and intentionally appears in NO
// role grant (see permissions.ts PROTECTED_ACTIONS).
//
// Framework-free data; the authoritative resolver in authorization.ts
// (server-only) consumes it.

import type { UserRole } from "@/server/db/database.types";
import type { Permission, RecordScope } from "./permissions";

export type Grant = RecordScope | true;
export type GrantMap = Partial<Record<Permission, Grant>>;

const OWNER: GrantMap = {
  "organization.view": true,
  "organization.settings": true,
  "organization.delete": true,
  "settings.view": true,
  "settings.manage": true,
  "team.view": true,
  "team.invite": true,
  "team.deactivate": true,
  "team.reactivate": true,
  "team.remove": true,
  "team.change_role": true,
  "invitations.view": true,
  "invitations.revoke": true,
  "invitations.resend": true,
  "roles.view": true,
  "roles.manage": true,
  "clients.view": "all",
  "clients.create": true,
  "clients.edit": "all",
  "clients.archive": "all",
  "clients.delete": "all",
  "clients.export": "all",
  "contacts.view": "all",
  "contacts.create": true,
  "contacts.edit": "all",
  "contacts.delete": "all",
  "tasks.view": "all",
  "tasks.create": true,
  "tasks.edit": "all",
  "tasks.change_status": "all",
  "tasks.archive": "all",
  "tasks.delete": "all",
  "tasks.assign_self": true,
  "tasks.assign_others": true,
  "notifications.view": true,
  "notifications.manage": true,
  "billing.view": true,
  "billing.manage": true,
};

// Manager (internal key `admin`).
const MANAGER: GrantMap = {
  "organization.view": true,
  // organization.settings / delete: DENY (owner-only)
  "settings.view": true,
  // settings.manage: DENY (default; configurable later)
  "team.view": true,
  "team.invite": true,
  "team.deactivate": true,
  "team.reactivate": true,
  // team.remove: DENY (future, owner-only)
  "team.change_role": true, // employee-target only — enforced via invariants in the team migration
  "invitations.view": true,
  "invitations.revoke": true,
  "invitations.resend": true,
  "roles.view": true,
  // roles.manage: DENY (owner-only, Phase 2)
  "clients.view": "all",
  "clients.create": true,
  "clients.edit": "all",
  "clients.archive": "all",
  // clients.delete / export: DENY (owner-only / future)
  "contacts.view": "all",
  "contacts.create": true,
  "contacts.edit": "all",
  "contacts.delete": "all", // Owner + Manager only
  "tasks.view": "all",
  "tasks.create": true,
  "tasks.edit": "all",
  "tasks.change_status": "all",
  "tasks.archive": "all",
  "tasks.delete": "all",
  "tasks.assign_self": true,
  "tasks.assign_others": true,
  "notifications.view": true,
  "notifications.manage": true,
  // billing: DENY
};

const EMPLOYEE: GrantMap = {
  "organization.view": true,
  "settings.view": true,
  "team.view": true, // basic roster
  // invitations / roles / team management: DENY
  "clients.view": "all", // Phase 1: employees still see all clients (preserve behavior)
  "clients.create": true,
  "clients.edit": "all",
  // clients.archive / delete / export: DENY
  "contacts.view": "all",
  "contacts.create": true,
  "contacts.edit": "all",
  // contacts.delete: DENY (Owner/Manager only)
  "tasks.view": "all",
  "tasks.create": true,
  "tasks.edit": "all",
  "tasks.change_status": "all",
  "tasks.archive": "all",
  "tasks.delete": "all",
  "tasks.assign_self": true,
  "tasks.assign_others": true, // Phase 1 preserves current open assignment; target model = self-only
  "notifications.view": true,
  "notifications.manage": true,
};

export const ROLE_GRANTS: Record<UserRole, GrantMap> = {
  owner: OWNER,
  admin: MANAGER,
  employee: EMPLOYEE,
};
