import "server-only";

// SHADOW-MODE DB role resolver (Phase 8H) - NON-AUTHORITATIVE, DISABLED BY DEFAULT.
//
// The `roles` / `role_permissions` tables and
// `organization_memberships.role_id` are live-schema inputs for parity only.
// The legacy membership `role` and code-defined `ROLE_GRANTS` map stay
// authoritative; this module must never change an authorization decision.
//
// Guarantees (all unit-tested):
//   * Disabled by default. Missing/any-other env value => disabled.
//   * When disabled, `runShadowParity` returns immediately and NEVER calls the
//     loader => ZERO new-table queries in every environment today.
//   * It NEVER changes an authorization decision. The code `ROLE_GRANTS` map
//     stays authoritative; this only produces an OBSERVATIONAL parity report.
//   * Fail-closed mapping: unknown permission keys and invalid scopes are
//     dropped; `ownership.transfer` is never admitted as a grant.

import type { FullSession } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/db/supabase";
import type { UserRole } from "@/server/db/domain.types";
import { ROLE_GRANTS, type Grant, type GrantMap } from "./permission-grants";
import {
  PERMISSIONS,
  PROTECTED_ACTIONS,
  RECORD_SCOPES,
  type Permission,
  type RecordScope,
} from "./permissions";

export type RolePermissionRow = {
  permission_key: string;
  record_scope: string | null;
};

type MembershipRoleRow = {
  role_id: string | null;
  org_id: string;
  is_active: boolean;
};

type RoleOwnershipRow = {
  id: string;
  org_id: string;
};

export type RoleGrantLoader = (
  session: FullSession,
) => Promise<RolePermissionRow[]>;

export type DbRoleResolveFailureReason =
  | "membership_query_error"
  | "missing_membership"
  | "inactive_membership"
  | "missing_role_id"
  | "role_query_error"
  | "missing_role"
  | "role_org_mismatch"
  | "permissions_query_error"
  | "malformed_permission_row"
  | "ambiguous_permission_rows";

export type DbRoleResolveResult =
  | {
      ok: true;
      rows: RolePermissionRow[];
      grantMap: GrantMap;
    }
  | {
      ok: false;
      reason: DbRoleResolveFailureReason;
    };

const PERMISSION_KEYS = new Set<string>(Object.values(PERMISSIONS));
const VALID_SCOPES = new Set<string>(RECORD_SCOPES);

// Feature flag. Disabled unless explicitly "1". Missing/any-other => off.
export const DB_ROLE_SHADOW_ENV = "DB_ROLE_RESOLVER_SHADOW";
export function isDbRoleShadowEnabled(): boolean {
  return process.env[DB_ROLE_SHADOW_ENV] === "1";
}

// Build a GrantMap from DB rows. Fail-closed: unknown permission keys and
// invalid scopes are SKIPPED (never widen access); ownership.transfer is never
// admitted. Mirrors code semantics (true = contextless grant; a RecordScope
// string = scoped grant).
export function buildGrantMapFromRows(rows: RolePermissionRow[]): GrantMap {
  const map: GrantMap = {};
  for (const row of rows) {
    const key = row.permission_key;
    if (!PERMISSION_KEYS.has(key)) continue; // unknown permission => skip
    if (key === PROTECTED_ACTIONS.OWNERSHIP_TRANSFER) continue; // never grantable
    if (row.record_scope === null) {
      map[key as Permission] = true;
    } else if (VALID_SCOPES.has(row.record_scope)) {
      map[key as Permission] = row.record_scope as RecordScope;
    }
    // invalid scope => skip (fail-closed)
  }
  return map;
}

function isRolePermissionRow(value: unknown): value is RolePermissionRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<RolePermissionRow>;
  return (
    typeof row.permission_key === "string" &&
    (row.record_scope === null || typeof row.record_scope === "string")
  );
}

function validatePermissionRows(
  rows: unknown[] | null,
): RolePermissionRow[] | DbRoleResolveFailureReason {
  if (!rows) return [];

  const seen = new Set<string>();
  const validRows: RolePermissionRow[] = [];

  for (const row of rows) {
    if (!isRolePermissionRow(row)) return "malformed_permission_row";
    const ambiguityKey = `${row.permission_key}\u0000${row.record_scope ?? ""}`;
    if (seen.has(ambiguityKey)) return "ambiguous_permission_rows";
    seen.add(ambiguityKey);
    validRows.push(row);
  }

  return validRows;
}

export async function resolveDbRoleGrants(
  session: FullSession,
): Promise<DbRoleResolveResult> {
  const supabase = await createSupabaseServerClient();

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("role_id, org_id, is_active")
    .eq("user_id", session.user.id)
    .eq("org_id", session.activeOrg.id)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError) return { ok: false, reason: "membership_query_error" };
  if (!membership) return { ok: false, reason: "missing_membership" };

  const membershipRow = membership as MembershipRoleRow;
  if (!membershipRow.is_active) {
    return { ok: false, reason: "inactive_membership" };
  }
  if (membershipRow.org_id !== session.activeOrg.id) {
    return { ok: false, reason: "missing_membership" };
  }
  if (!membershipRow.role_id) return { ok: false, reason: "missing_role_id" };

  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("id, org_id")
    .eq("id", membershipRow.role_id)
    .maybeSingle();

  if (roleError) return { ok: false, reason: "role_query_error" };
  if (!role) return { ok: false, reason: "missing_role" };

  const roleRow = role as RoleOwnershipRow;
  if (roleRow.org_id !== session.activeOrg.id) {
    return { ok: false, reason: "role_org_mismatch" };
  }

  const { data: permissionRows, error: permissionError } = await supabase
    .from("role_permissions")
    .select("permission_key, record_scope")
    .eq("role_id", roleRow.id);

  if (permissionError) {
    return { ok: false, reason: "permissions_query_error" };
  }

  const rowsOrFailure = validatePermissionRows(permissionRows);
  if (typeof rowsOrFailure === "string") {
    return { ok: false, reason: rowsOrFailure };
  }

  return {
    ok: true,
    rows: rowsOrFailure,
    grantMap: buildGrantMapFromRows(rowsOrFailure),
  };
}

export async function loadDbRoleGrantRows(
  session: FullSession,
): Promise<RolePermissionRow[]> {
  const result = await resolveDbRoleGrants(session);
  return result.ok ? result.rows : [];
}

export type ParityCategory =
  | "match"
  | "code_allow_db_deny" // code grants, DB does not
  | "code_deny_db_allow" // DB grants, code does not
  | "scope_mismatch"; // both grant, scopes differ

export type ParityResult = {
  role: UserRole;
  match: boolean;
  counts: Record<ParityCategory, number>;
  // permission KEYS per discrepancy (safe to log: keys only, no PII)
  codeAllowDbDeny: Permission[];
  codeDenyDbAllow: Permission[];
  scopeMismatch: Permission[];
};

function grantToken(g: Grant | undefined): string {
  return g === undefined ? "DENY" : g === true ? "ALLOW" : `ALLOW:${g}`;
}

// Compare a DB-derived GrantMap to the authoritative code grants for a role.
export function compareToCode(role: UserRole, dbMap: GrantMap): ParityResult {
  const codeMap = ROLE_GRANTS[role] ?? {};
  const keys = new Set<Permission>([
    ...(Object.keys(codeMap) as Permission[]),
    ...(Object.keys(dbMap) as Permission[]),
  ]);
  const counts: Record<ParityCategory, number> = {
    match: 0,
    code_allow_db_deny: 0,
    code_deny_db_allow: 0,
    scope_mismatch: 0,
  };
  const codeAllowDbDeny: Permission[] = [];
  const codeDenyDbAllow: Permission[] = [];
  const scopeMismatch: Permission[] = [];

  for (const k of keys) {
    const c = codeMap[k];
    const d = dbMap[k];
    if (grantToken(c) === grantToken(d)) {
      counts.match++;
    } else if (c !== undefined && d === undefined) {
      counts.code_allow_db_deny++;
      codeAllowDbDeny.push(k);
    } else if (c === undefined && d !== undefined) {
      counts.code_deny_db_allow++;
      codeDenyDbAllow.push(k);
    } else {
      counts.scope_mismatch++;
      scopeMismatch.push(k);
    }
  }

  return {
    role,
    match:
      counts.code_allow_db_deny === 0 &&
      counts.code_deny_db_allow === 0 &&
      counts.scope_mismatch === 0,
    counts,
    codeAllowDbDeny,
    codeDenyDbAllow,
    scopeMismatch,
  };
}

export type ShadowOutcome =
  | { enabled: false }
  | { enabled: true; parity: ParityResult };

// Observational shadow parity. NEVER authoritative. When disabled, returns
// immediately WITHOUT invoking the loader (=> zero new-table queries).
export async function runShadowParity(
  session: FullSession,
  loadRows: RoleGrantLoader,
): Promise<ShadowOutcome> {
  if (!isDbRoleShadowEnabled()) return { enabled: false };
  const rows = await loadRows(session);
  const dbMap = buildGrantMapFromRows(rows);
  const parity = compareToCode(session.activeRole, dbMap);
  return { enabled: true, parity };
}

// Safe telemetry - categories + counts only (no PII, no tokens, no record
// contents). Mirrors the safety posture of authzLogMeta.
export type ShadowParityLogMeta = {
  category: "authz_shadow_parity";
  role: UserRole;
  orgId: string;
  match: boolean;
  counts: Record<ParityCategory, number>;
};

export function shadowParityLogMeta(
  session: FullSession,
  parity: ParityResult,
): ShadowParityLogMeta {
  return {
    category: "authz_shadow_parity",
    role: session.activeRole,
    orgId: session.activeOrg.id,
    match: parity.match,
    counts: parity.counts,
  };
}
