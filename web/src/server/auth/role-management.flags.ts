import "server-only";

// Feature flags for the custom-roles MANAGEMENT feature (Phase 8K). Both are
// DISABLED by default (enabled only for the exact value "1"); missing/any other
// value => off. They are intentionally SEPARATE so the UI can be revealed
// without enabling writes, and neither has anything to do with the authorization
// flags (DB_ROLE_RESOLVER_SHADOW / DB_ROLE_AUTHORITATIVE) which govern whether DB
// roles are observed / authoritative.
//
//   ROLES_MANAGEMENT_UI    — render the role-management screen + nav entry.
//   ROLES_MANAGEMENT_WRITE — allow create/update/delete/duplicate writes.
//
// With both off (default) there is no roles UI and every write route returns 403
// at the service boundary, in addition to the DB-side owner gate in the RPCs.

export const ROLES_MGMT_UI_ENV = "ROLES_MANAGEMENT_UI";
export const ROLES_MGMT_WRITE_ENV = "ROLES_MANAGEMENT_WRITE";

export function isRoleManagementUiEnabled(): boolean {
  return process.env[ROLES_MGMT_UI_ENV] === "1";
}

export function isRoleManagementWriteEnabled(): boolean {
  return process.env[ROLES_MGMT_WRITE_ENV] === "1";
}
