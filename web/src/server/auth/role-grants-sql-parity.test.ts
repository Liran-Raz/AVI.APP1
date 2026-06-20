// Parity guard: the SQL seed in supabase/migrations/0012_seed_system_roles_and_grants.sql
// MUST match the authoritative TypeScript ROLE_GRANTS map exactly. This fails
// the build on any drift (a TS grant missing from SQL, an extra/unknown SQL
// grant, a scope mismatch, or ownership.transfer sneaking into a grant).
//
// The committed migration stays deterministic SQL (no Node tooling at apply
// time); this test performs *extraction + comparison*, not generation.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { ROLE_GRANTS } from "./permission-grants";
import { PERMISSIONS, RECORD_SCOPES } from "./permissions";

type Tuple = { role: string; permission: string; scope: string | null };
const keyOf = (t: Tuple) => `${t.role}|${t.permission}|${t.scope ?? "NULL"}`;

const PERMISSION_KEYS = new Set<string>(Object.values(PERMISSIONS));
const VALID_SCOPES = new Set<string>(RECORD_SCOPES);

// ---- TypeScript side: flatten ROLE_GRANTS into tuples ----
function tsTuples(): Tuple[] {
  const out: Tuple[] = [];
  for (const [role, grants] of Object.entries(ROLE_GRANTS)) {
    for (const [permission, value] of Object.entries(grants)) {
      out.push({
        role,
        permission,
        scope: value === true ? null : (value as string),
      });
    }
  }
  return out;
}

// ---- SQL side: parse the grant_catalog VALUES rows ----
function sqlTuples(): Tuple[] {
  const sqlPath = resolve(
    process.cwd(),
    "..",
    "supabase",
    "migrations",
    "0012_seed_system_roles_and_grants.sql",
  );
  const sql = readFileSync(sqlPath, "utf8");
  // Match rows like:  ('owner', 'clients.view', 'all')  /  ('owner', 'x.y', null::text)
  // permission keys always contain a dot, so the 2-tuple role-seed rows
  // (('owner','Owner')) never match.
  const re =
    /\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+\.[a-z_]+)'\s*,\s*(null(?:::text)?|'([a-z]+)')\s*\)/gi;
  const out: Tuple[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const raw = m[3].toLowerCase();
    out.push({
      role: m[1],
      permission: m[2],
      scope: raw.startsWith("null") ? null : m[4],
    });
  }
  return out;
}

describe("0012 seed ↔ ROLE_GRANTS parity", () => {
  const ts = tsTuples();
  const sql = sqlTuples();

  it("parses a non-trivial number of SQL grant rows", () => {
    expect(sql.length).toBeGreaterThan(50);
  });

  it("every SQL grant uses a known permission key and valid scope", () => {
    for (const t of sql) {
      expect(PERMISSION_KEYS.has(t.permission), `unknown permission: ${t.permission}`).toBe(true);
      if (t.scope !== null) {
        expect(VALID_SCOPES.has(t.scope), `invalid scope: ${t.scope}`).toBe(true);
      }
    }
  });

  it("SQL has no duplicate (role, permission) rows", () => {
    const seen = new Set<string>();
    for (const t of sql) {
      const k = `${t.role}|${t.permission}`;
      expect(seen.has(k), `duplicate grant: ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it("TS and SQL grant sets are identical (no missing, no extra, scopes match)", () => {
    const tsSet = new Set(ts.map(keyOf));
    const sqlSet = new Set(sql.map(keyOf));
    const missingInSql = [...tsSet].filter((k) => !sqlSet.has(k));
    const extraInSql = [...sqlSet].filter((k) => !tsSet.has(k));
    expect(missingInSql, "TS grants missing from SQL").toEqual([]);
    expect(extraInSql, "SQL grants not in TS").toEqual([]);
    expect(sql.length).toBe(ts.length);
  });

  it("ownership.transfer is never granted (protected action)", () => {
    expect(sql.some((t) => t.permission === "ownership.transfer")).toBe(false);
    expect(ts.some((t) => t.permission === "ownership.transfer")).toBe(false);
  });

  it("preserves the recorded behavioral invariants", () => {
    const has = (role: string, perm: string) =>
      sql.some((t) => t.role === role && t.permission === perm);
    // employee KEEPS tasks.assign_others (Phase-1 compatibility)
    expect(has("employee", "tasks.assign_others")).toBe(true);
    // employee does NOT get contacts.delete; Owner + Manager do
    expect(has("employee", "contacts.delete")).toBe(false);
    expect(has("admin", "contacts.delete")).toBe(true);
    expect(has("owner", "contacts.delete")).toBe(true);
    // roles.manage is owner-only; clients.archive denied to employee
    expect(has("owner", "roles.manage")).toBe(true);
    expect(has("admin", "roles.manage")).toBe(false);
    expect(has("employee", "clients.archive")).toBe(false);
  });
});
