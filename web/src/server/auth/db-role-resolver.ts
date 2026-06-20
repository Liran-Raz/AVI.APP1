import "server-only";

// SHADOW-MODE DB role resolver (Phase 8H) — NON-AUTHORITATIVE, DISABLED BY DEFAULT.
//
// AWAITING OPERATOR DB CONFIRMATION: the `roles` / `role_permissions` tables and
// `organization_memberships.role_id` are created by migrations 0011/0012/0013,
// which are NOT yet applied to any database. This module therefore NEVER queries
// those tables itself — it receives rows through a dependency-injected loader.
// The concrete Supabase loader is deferred until the migrations are applied AND
// `database.types.ts` is regenerated (the typed Supabase client cannot reference
// the new tables before then, so writing one now would not type-check).
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
import type { UserRole } from "@/server/db/database.types";
import { ROLE_GRANTS, type Grant, type GrantMap } from "./permission-grants";
import {
  PERMISSIONS,
  PROTECTED_ACTIONS,
  RECORD_SCOPES,
  type Permission,
  type RecordScope,
} from "./permissions";

// One role_permissions row as the resolver consumes it. Loader-shaped (plain
// fields, no Supabase types) so this compiles before the tables/types exist.
export type RolePermissionRow = {
  permission_key: string;
  record_scope: string | null;
};

// Loader contract (dependency-injected). The concrete Supabase implementation
// is deferred (AWAITING OPERATOR DB CONFIRMATION); tests inject a fake.
export type RoleGrantLoader = (
  session: FullSession,
) => Promise<RolePermissionRow[]>;

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

export type ParityCategory =
  | "match"
  | "code_allow_db_deny" // code grants, DB does not
  | "code_deny_db_allow" // DB grants, code does not  <-- privilege-escalation signal
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

// Safe telemetry — categories + counts only (no PII, no tokens, no record
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
