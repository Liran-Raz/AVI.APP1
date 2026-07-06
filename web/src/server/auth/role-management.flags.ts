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
//
// IMPORTANT — these flags are NOT the security boundary. They gate only the app
// routes; they cannot stop a signed-in user from calling a management RPC
// directly through Supabase/PostgREST. The authoritative OFF state lives in the
// DATABASE: migration 0016 creates the five RPCs DB-DORMANT (EXECUTE revoked
// from PUBLIC, anon AND authenticated), so a direct call fails with 42501
// before the function body runs. Turning a flag on here does nothing until the
// matching versioned DB rollout migration grants EXECUTE — see
// docs/security/ROLE_MANAGEMENT_DB_DORMANCY.md for the activation order.

export const ROLES_MGMT_UI_ENV = "ROLES_MANAGEMENT_UI";
export const ROLES_MGMT_WRITE_ENV = "ROLES_MANAGEMENT_WRITE";

export function isRoleManagementUiEnabled(): boolean {
  return process.env[ROLES_MGMT_UI_ENV] === "1";
}

export function isRoleManagementWriteEnabled(): boolean {
  return process.env[ROLES_MGMT_WRITE_ENV] === "1";
}
