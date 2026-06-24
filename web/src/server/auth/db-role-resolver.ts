import "server-only";

// SHADOW-MODE DB role resolver (Phase 8H/8I) - NON-AUTHORITATIVE, DISABLED BY
// DEFAULT.
//
// The `roles` / `role_permissions` tables and
// `organization_memberships.role_id` are live-schema inputs for PARITY ONLY.
// The legacy membership `role` and the code-defined `ROLE_GRANTS` map stay
// authoritative; this module must never change an authorization decision
// (until the separately-gated cutover, which is itself behind a disabled flag).
//
// READ SURFACE (Phase 8I): the locked-down `roles`/`role_permissions` tables
// (RLS on, zero policies, revoked from anon+authenticated) cannot be read by
// the user-scoped client. The ONLY read surface is the SECURITY DEFINER RPC
// `public.resolve_my_role_permissions(p_org_id)` (migration 0014), which
// resolves the caller's own active-membership role + grants server-side from
// auth.uid(). This module calls that RPC — never the tables directly.
//
// Guarantees (all unit-tested):
//   * Disabled by default. Missing/any-other env value => disabled.
//   * When disabled, `runShadowParity` returns immediately and NEVER resolves
//     DB grants => ZERO RPC calls in every environment today.
//   * Exception-safe: every DB interaction is guarded; a throw/rejection
//     becomes a structured failure reason and never escapes into a request.
//   * Operational failures are preserved as distinct reason codes (never
//     collapsed into an empty permission set), so the parity layer can tell a
//     DB failure apart from a legitimate result.
//   * Strict validation: unknown permission keys, `ownership.transfer`,
//     scope-invalid rows, and duplicate keys yield a structured failure rather
//     than a silently narrowed grant set.

import type { FullSession } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Tables } from "@/server/db/database.types";
import type { UserRole } from "@/server/db/domain.types";
import { ROLE_GRANTS, type Grant, type GrantMap } from "./permission-grants";
import {
  PERMISSIONS,
  PERMISSION_META,
  PROTECTED_ACTIONS,
  RECORD_SCOPES,
  type Permission,
  type RecordScope,
} from "./permissions";

// Row shape derived from the generated schema types (never hand-duplicated).
export type RolePermissionRow = Pick<
  Tables<"role_permissions">,
  "permission_key" | "record_scope"
>;

export type DbRoleResolveFailureReason =
  | "unexpected_error"
  | "rpc_error"
  | "missing_membership"
  | "malformed_permission_row"
  | "ambiguous_permission_rows"
  | "unknown_permission_key"
  | "ownership_permission"
  | "missing_scope"
  | "invalid_scope"
  | "unexpected_scope";

export type DbRoleResolveResult =
  | { ok: true; rows: RolePermissionRow[]; grantMap: GrantMap }
  | { ok: false; reason: DbRoleResolveFailureReason };

// Dependency-injected resolver (defaults to resolveDbRoleGrants); lets the
// shadow/parity layer be unit-tested without a database.
export type DbRoleResolver = (
  session: FullSession,
) => Promise<DbRoleResolveResult>;

const PERMISSION_KEYS = new Set<string>(Object.values(PERMISSIONS));
const VALID_SCOPES = new Set<string>(RECORD_SCOPES);

// Feature flag. Disabled unless explicitly "1". Missing/any-other => off.
export const DB_ROLE_SHADOW_ENV = "DB_ROLE_RESOLVER_SHADOW";
export function isDbRoleShadowEnabled(): boolean {
  return process.env[DB_ROLE_SHADOW_ENV] === "1";
}

// CUTOVER feature flag (Phase 8J). Disabled unless explicitly "1".
// When ON, the session carries a DB-resolved GrantMap and the authorization
// engine reads grants from it instead of the in-code ROLE_GRANTS map. When OFF
// (default), behavior is byte-for-byte identical to today. The resolved map
// falls back to the code map on any resolver failure (no lockout); since
// system-role grants are parity-verified equal to the code map and custom roles
// are not yet assignable to members, enabling this is functionally a no-op until
// role assignment ships in a later, separately-gated phase.
export const DB_ROLE_AUTHORITATIVE_ENV = "DB_ROLE_AUTHORITATIVE";
export function isDbRoleAuthoritativeEnabled(): boolean {
  return process.env[DB_ROLE_AUTHORITATIVE_ENV] === "1";
}

// Build a GrantMap from already-validated rows. Mirrors code semantics
// (true = contextless grant; a RecordScope string = scoped grant). The resolver
// validates and rejects invalid rows upstream, so this never silently narrows a
// resolver result; the residual guards keep it safe when used directly (e.g.
// for code-side parity input in tests).
export function buildGrantMapFromRows(rows: RolePermissionRow[]): GrantMap {
  const map: GrantMap = {};
  for (const row of rows) {
    const key = row.permission_key;
    if (!PERMISSION_KEYS.has(key)) continue;
    if (key === PROTECTED_ACTIONS.OWNERSHIP_TRANSFER) continue;
    if (row.record_scope === null) {
      map[key as Permission] = true;
    } else if (VALID_SCOPES.has(row.record_scope)) {
      map[key as Permission] = row.record_scope as RecordScope;
    }
  }
  return map;
}

function isRolePermissionRow(value: unknown): value is RolePermissionRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as { permission_key?: unknown; record_scope?: unknown };
  return (
    typeof row.permission_key === "string" &&
    (row.record_scope === null || typeof row.record_scope === "string")
  );
}

// Strictly validate raw permission rows. Returns a structured failure reason
// rather than silently dropping invalid rows. Enforces: well-formed shape;
// `ownership.transfer` rejected; known catalog key; scope present + valid for
// scoped permissions and null for contextless ones; no duplicate permission key
// (even with differing scopes).
function validatePermissionRows(
  rows: unknown[] | null,
): RolePermissionRow[] | DbRoleResolveFailureReason {
  if (!rows) return [];
  const seenKeys = new Set<string>();
  const validRows: RolePermissionRow[] = [];

  for (const row of rows) {
    if (!isRolePermissionRow(row)) return "malformed_permission_row";
    const key = row.permission_key;
    if (key === PROTECTED_ACTIONS.OWNERSHIP_TRANSFER) {
      return "ownership_permission";
    }
    if (!PERMISSION_KEYS.has(key)) return "unknown_permission_key";
    const meta = PERMISSION_META[key as Permission];
    if (meta.scoped) {
      if (row.record_scope === null) return "missing_scope";
      if (!VALID_SCOPES.has(row.record_scope)) return "invalid_scope";
    } else if (row.record_scope !== null) {
      return "unexpected_scope";
    }
    if (seenKeys.has(key)) return "ambiguous_permission_rows";
    seenKeys.add(key);
    validRows.push(row);
  }

  return validRows;
}

// Resolve the active membership's DB-backed grants via the secure read RPC
// (migration 0014). NON-AUTHORITATIVE and exception-safe.
//
// The RPC `resolve_my_role_permissions(p_org_id)` returns rows
// `{ role_key, is_system, permission_key, record_scope }`, scoped server-side to
// the authenticated caller's OWN active membership in p_org_id:
//   * 0 rows                        => no active same-org role (fail-closed).
//   * 1 row, permission_key = null  => valid role with ZERO grants (sentinel).
//   * >=1 rows, permission_key set  => the role's grants.
// All membership/role/org-consistency checks (inactive, null role_id, cross-org,
// missing role) are enforced inside the SECURITY DEFINER function and collapse to
// "0 rows" here.
export async function resolveDbRoleGrants(
  session: FullSession,
): Promise<DbRoleResolveResult> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.rpc("resolve_my_role_permissions", {
      p_org_id: session.activeOrg.id,
    });

    if (error) return { ok: false, reason: "rpc_error" };

    const rows = data ?? [];
    if (rows.length === 0) {
      // No active same-org role surfaced by the RPC = no access.
      return { ok: false, reason: "missing_membership" };
    }

    // Drop the zero-permission sentinel (permission_key = null) before
    // validation. A valid role with grants never carries a null permission_key,
    // so this leaves exactly the grant rows (or an empty set for the sentinel).
    const permissionRows = rows
      .filter(
        (r): r is typeof r & { permission_key: string } =>
          r.permission_key !== null,
      )
      .map((r) => ({
        permission_key: r.permission_key,
        record_scope: r.record_scope,
      }));

    const rowsOrFailure = validatePermissionRows(permissionRows);
    if (typeof rowsOrFailure === "string") {
      return { ok: false, reason: rowsOrFailure };
    }

    return {
      ok: true,
      rows: rowsOrFailure,
      grantMap: buildGrantMapFromRows(rowsOrFailure),
    };
  } catch {
    // Any unexpected throw/rejection (client creation, network, runtime) fails
    // closed. The error is intentionally not surfaced/logged here because it may
    // carry connection or query detail; callers receive only a safe reason.
    return { ok: false, reason: "unexpected_error" };
  }
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
  | { enabled: true; ok: true; parity: ParityResult }
  | { enabled: true; ok: false; reason: DbRoleResolveFailureReason };

// Observational shadow parity. NEVER authoritative. When disabled, returns
// immediately WITHOUT resolving DB grants (=> zero RPC calls). When enabled, a
// DB failure is preserved as a reason (not a parity comparison against an empty
// set), and any thrown/rejected resolver fails closed.
export async function runShadowParity(
  session: FullSession,
  resolve: DbRoleResolver = resolveDbRoleGrants,
): Promise<ShadowOutcome> {
  if (!isDbRoleShadowEnabled()) return { enabled: false };

  let result: DbRoleResolveResult;
  try {
    result = await resolve(session);
  } catch {
    return { enabled: true, ok: false, reason: "unexpected_error" };
  }

  if (!result.ok) return { enabled: true, ok: false, reason: result.reason };

  const parity = compareToCode(session.activeRole, result.grantMap);
  return { enabled: true, ok: true, parity };
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

// Fire-and-forget shadow parity. Safe to call on every full-session build: when
// the shadow flag is OFF it returns immediately (zero RPC). When ON, it runs the
// parity probe once and emits a SINGLE PII-free telemetry line (categories +
// counts only). Never throws — shadow telemetry must never affect a request.
export async function fireShadowParity(session: FullSession): Promise<void> {
  try {
    const outcome = await runShadowParity(session);
    if (!outcome.enabled) return;
    if (outcome.ok) {
      console.info(
        "[authz.shadow]",
        JSON.stringify(shadowParityLogMeta(session, outcome.parity)),
      );
    } else {
      console.warn(
        "[authz.shadow]",
        JSON.stringify({
          category: "authz_shadow_parity_error",
          role: session.activeRole,
          orgId: session.activeOrg.id,
          reason: outcome.reason,
        }),
      );
    }
  } catch {
    // never let shadow telemetry affect a request
  }
}
