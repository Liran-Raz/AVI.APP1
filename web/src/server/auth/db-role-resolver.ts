import "server-only";

// DB role resolver + shadow parity + authoritative cutover plumbing (Phase
// 8H/8I/8J). NON-AUTHORITATIVE until the cutover flag is on; even then it is
// FAIL-CLOSED (never silently falls back to the in-code ROLE_GRANTS).
//
// READ SURFACE: the locked-down roles/role_permissions tables (RLS on, zero
// policies, revoked) are read ONLY through the SECURITY DEFINER RPC
// `public.resolve_my_role_permissions(p_org_id)` (migration 0014), scoped
// server-side by auth.uid(). This module calls that RPC, with a bounded timeout.
//
// FLAGS (all OFF by default; enabled only for the exact value "1"):
//   DB_ROLE_RESOLVER_SHADOW  — observational parity probe (never authoritative).
//   DB_ROLE_AUTHORITATIVE    — cutover: the session carries a DB grant map and
//                              the engine reads it. On ANY resolution failure the
//                              authoritative map is DENY-ALL ({}), never the
//                              legacy code map (fail-closed).
//
// Guarantees (unit-tested):
//   * Disabled by default => zero RPC, byte-for-byte today's behavior.
//   * Bounded timeout on the RPC; a timeout is a structured failure, not a hang.
//   * Exception-safe: every DB interaction is guarded; a throw/rejection becomes
//     a structured reason and never escapes into a request.
//   * Authoritative ON + failure => deny-all grant map + safe structured log;
//     it NEVER grants legacy permissions silently.
//   * Strict validation: unknown keys, ownership.transfer, scope-invalid rows,
//     and duplicates yield a structured failure, not a silently narrowed set.

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
  | "timeout"
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

// ---- Feature flags (enabled only for exactly "1"; missing/other => off) ----
export const DB_ROLE_SHADOW_ENV = "DB_ROLE_RESOLVER_SHADOW";
export function isDbRoleShadowEnabled(): boolean {
  return process.env[DB_ROLE_SHADOW_ENV] === "1";
}

// CUTOVER flag (Phase 8J). When ON, the engine reads the session's DB grant map
// (see authoritativeGrantMap — fail-closed on failure). OFF => identical to today.
export const DB_ROLE_AUTHORITATIVE_ENV = "DB_ROLE_AUTHORITATIVE";
export function isDbRoleAuthoritativeEnabled(): boolean {
  return process.env[DB_ROLE_AUTHORITATIVE_ENV] === "1";
}

// ---- Bounded RPC timeout ----
// Real, enforced upper bound on how long the authoritative path waits for the
// RPC. On expiry the wait rejects (RpcTimeoutError) and resolves to reason
// "timeout" (the underlying request is abandoned). Default 4s; injectable for
// tests via resolveDbRoleGrants(session, { timeoutMs }).
export const DB_ROLE_RPC_TIMEOUT_MS = 4000;

class RpcTimeoutError extends Error {
  constructor() {
    super("db-role RPC timed out");
    this.name = "RpcTimeoutError";
  }
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RpcTimeoutError()), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Build a GrantMap from already-validated rows. Mirrors code semantics
// (true = contextless grant; a RecordScope string = scoped grant).
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
// rather than silently dropping invalid rows.
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
// (migration 0014), with a bounded timeout. NON-AUTHORITATIVE and exception-safe.
//   * 0 rows                        => missing_membership (fail-closed).
//   * 1 row, permission_key = null  => valid role with ZERO grants (sentinel).
//   * >=1 rows, permission_key set  => the role's grants.
export async function resolveDbRoleGrants(
  session: FullSession,
  opts?: { timeoutMs?: number },
): Promise<DbRoleResolveResult> {
  const timeoutMs = opts?.timeoutMs ?? DB_ROLE_RPC_TIMEOUT_MS;
  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await withTimeout(
      supabase.rpc("resolve_my_role_permissions", {
        p_org_id: session.activeOrg.id,
      }),
      timeoutMs,
    );

    if (error) return { ok: false, reason: "rpc_error" };

    const rows = data ?? [];
    if (rows.length === 0) {
      return { ok: false, reason: "missing_membership" };
    }

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
  } catch (e) {
    if (e instanceof RpcTimeoutError) return { ok: false, reason: "timeout" };
    // Any other unexpected throw/rejection fails closed. Not surfaced/logged
    // here (may carry connection/query detail); callers get a safe reason.
    return { ok: false, reason: "unexpected_error" };
  }
}

// FAIL-CLOSED authoritative grant map. Under DB_ROLE_AUTHORITATIVE the engine
// reads THIS map for every decision:
//   * ok (incl. the zero-permission sentinel) => the resolved grants (maybe {}).
//   * ANY failure (rpc_error/timeout/unexpected/missing_membership/malformed/
//     unknown/scope/duplicate) => DENY-ALL ({}). It NEVER returns the legacy map.
export function authoritativeGrantMap(result: DbRoleResolveResult): GrantMap {
  return result.ok ? result.grantMap : {};
}

// PII-free structured log for an authoritative-resolution failure. No tokens, no
// PII, no raw DB error text, no query details — only stable codes.
export function logAuthoritativeResolutionFailure(
  session: FullSession,
  reason: DbRoleResolveFailureReason,
): void {
  console.error(
    "[authz.authoritative]",
    JSON.stringify({
      category: "authz_authoritative_resolution_failed",
      role: session.activeRole,
      orgId: session.activeOrg.id,
      reason,
    }),
  );
}

// ============================================================
// Shadow parity (observational; NEVER authoritative)
// ============================================================

export type ParityCategory =
  | "match"
  | "code_allow_db_deny"
  | "code_deny_db_allow"
  | "scope_mismatch";

export type ParityResult = {
  role: UserRole;
  match: boolean;
  counts: Record<ParityCategory, number>;
  codeAllowDbDeny: Permission[];
  codeDenyDbAllow: Permission[];
  scopeMismatch: Permission[];
};

function grantToken(g: Grant | undefined): string {
  return g === undefined ? "DENY" : g === true ? "ALLOW" : `ALLOW:${g}`;
}

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

// Build the shadow outcome from an ALREADY-resolved result (no RPC). Used by the
// reuse path so that, with both Shadow and Authoritative enabled, only ONE RPC
// is issued and the same validated result feeds both.
export function shadowOutcomeFromResult(
  session: FullSession,
  result: DbRoleResolveResult,
): ShadowOutcome {
  if (result.ok) {
    return {
      enabled: true,
      ok: true,
      parity: compareToCode(session.activeRole, result.grantMap),
    };
  }
  return { enabled: true, ok: false, reason: result.reason };
}

// Observational shadow parity. When disabled, returns immediately WITHOUT
// resolving (zero RPC). When enabled, a DB failure is preserved as a reason and
// any thrown/rejected resolver fails closed.
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
  return shadowOutcomeFromResult(session, result);
}

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

// Emit ONE PII-free telemetry line for a shadow outcome (never throws).
function logShadowOutcome(session: FullSession, outcome: ShadowOutcome): void {
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
}

// Fire-and-forget shadow parity (resolves internally). Used when Shadow is on
// and Authoritative is OFF — non-blocking, zero RPC when the flag is off.
export async function fireShadowParity(session: FullSession): Promise<void> {
  if (!isDbRoleShadowEnabled()) return;
  try {
    logShadowOutcome(session, await runShadowParity(session));
  } catch {
    // never let shadow telemetry affect a request
  }
}

// Emit shadow parity from an ALREADY-resolved result (no extra RPC). Used by the
// reuse path when BOTH flags are on (the authoritative path already resolved).
export function emitShadowParityFromResult(
  session: FullSession,
  result: DbRoleResolveResult,
): void {
  try {
    logShadowOutcome(session, shadowOutcomeFromResult(session, result));
  } catch {
    // never let shadow telemetry affect a request
  }
}
