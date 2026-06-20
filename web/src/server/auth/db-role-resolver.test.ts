import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FullSession } from "@/server/auth/session";
import type { UserRole } from "@/server/db/database.types";
import { ROLE_GRANTS, type GrantMap } from "./permission-grants";
import {
  DB_ROLE_SHADOW_ENV,
  buildGrantMapFromRows,
  compareToCode,
  isDbRoleShadowEnabled,
  runShadowParity,
  shadowParityLogMeta,
  type RolePermissionRow,
} from "./db-role-resolver";

function fakeSession(role: UserRole): FullSession {
  return {
    activeRole: role,
    activeOrg: { id: "org-1" },
    profile: { id: "user-1" },
  } as unknown as FullSession;
}

function rowsFromGrantMap(map: GrantMap): RolePermissionRow[] {
  return Object.entries(map).map(([permission_key, v]) => ({
    permission_key,
    record_scope: v === true ? null : (v as string),
  }));
}

// Each test starts with the flag unset; restore the original afterward.
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[DB_ROLE_SHADOW_ENV];
  delete process.env[DB_ROLE_SHADOW_ENV];
});
afterEach(() => {
  if (saved === undefined) delete process.env[DB_ROLE_SHADOW_ENV];
  else process.env[DB_ROLE_SHADOW_ENV] = saved;
});

describe("isDbRoleShadowEnabled (disabled by default)", () => {
  it("is false when unset", () => {
    expect(isDbRoleShadowEnabled()).toBe(false);
  });
  it('is true only for exactly "1"', () => {
    process.env[DB_ROLE_SHADOW_ENV] = "1";
    expect(isDbRoleShadowEnabled()).toBe(true);
  });
  it("is false for other truthy-looking values", () => {
    for (const v of ["0", "true", "yes", "on", ""]) {
      process.env[DB_ROLE_SHADOW_ENV] = v;
      expect(isDbRoleShadowEnabled()).toBe(false);
    }
  });
});

describe("runShadowParity is inert when disabled", () => {
  it("returns {enabled:false} and NEVER calls the loader", async () => {
    let called = false;
    const loader = async () => {
      called = true;
      return [];
    };
    const out = await runShadowParity(fakeSession("owner"), loader);
    expect(out).toEqual({ enabled: false });
    expect(called).toBe(false); // zero new-table queries when disabled
  });

  it("invokes the loader and reports parity only when enabled", async () => {
    process.env[DB_ROLE_SHADOW_ENV] = "1";
    const loader = async () => rowsFromGrantMap(ROLE_GRANTS.owner);
    const out = await runShadowParity(fakeSession("owner"), loader);
    expect(out.enabled).toBe(true);
    if (out.enabled) expect(out.parity.match).toBe(true);
  });
});

describe("buildGrantMapFromRows is fail-closed", () => {
  it("maps null -> true and a scope string -> scope", () => {
    const map = buildGrantMapFromRows([
      { permission_key: "team.view", record_scope: null },
      { permission_key: "clients.view", record_scope: "all" },
    ]);
    expect(map["team.view"]).toBe(true);
    expect(map["clients.view"]).toBe("all");
  });
  it("drops unknown permission keys", () => {
    const map = buildGrantMapFromRows([
      { permission_key: "bogus.permission", record_scope: null },
    ]);
    expect(Object.keys(map)).toHaveLength(0);
  });
  it("never admits ownership.transfer", () => {
    const map = buildGrantMapFromRows([
      { permission_key: "ownership.transfer", record_scope: null },
    ]);
    expect("ownership.transfer" in map).toBe(false);
  });
  it("drops invalid scopes", () => {
    const map = buildGrantMapFromRows([
      { permission_key: "clients.view", record_scope: "bogus" },
    ]);
    expect("clients.view" in map).toBe(false);
  });
});

describe("compareToCode", () => {
  it("reports perfect parity when DB mirrors the code grants", () => {
    for (const role of ["owner", "admin", "employee"] as UserRole[]) {
      const dbMap = buildGrantMapFromRows(rowsFromGrantMap(ROLE_GRANTS[role]));
      const r = compareToCode(role, dbMap);
      expect(r.match, `role ${role}`).toBe(true);
      expect(r.counts.code_deny_db_allow).toBe(0);
      expect(r.counts.code_allow_db_deny).toBe(0);
      expect(r.counts.scope_mismatch).toBe(0);
    }
  });

  it("flags a grant present in code but missing from DB", () => {
    const dbMap = buildGrantMapFromRows(rowsFromGrantMap(ROLE_GRANTS.owner));
    delete dbMap["roles.manage"];
    const r = compareToCode("owner", dbMap);
    expect(r.match).toBe(false);
    expect(r.counts.code_allow_db_deny).toBe(1);
    expect(r.codeAllowDbDeny).toContain("roles.manage");
  });

  it("flags an EXTRA DB grant (privilege-escalation signal)", () => {
    const dbMap = buildGrantMapFromRows(rowsFromGrantMap(ROLE_GRANTS.employee));
    dbMap["roles.manage"] = true; // employee must NOT have this
    const r = compareToCode("employee", dbMap);
    expect(r.match).toBe(false);
    expect(r.counts.code_deny_db_allow).toBe(1);
    expect(r.codeDenyDbAllow).toContain("roles.manage");
  });

  it("flags a scope mismatch", () => {
    const dbMap = buildGrantMapFromRows(rowsFromGrantMap(ROLE_GRANTS.employee));
    dbMap["clients.view"] = "own"; // code grants 'all'
    const r = compareToCode("employee", dbMap);
    expect(r.match).toBe(false);
    expect(r.counts.scope_mismatch).toBe(1);
    expect(r.scopeMismatch).toContain("clients.view");
  });
});

describe("shadowParityLogMeta is PII-free", () => {
  it("exposes only category/role/orgId/match/counts", () => {
    const dbMap = buildGrantMapFromRows(rowsFromGrantMap(ROLE_GRANTS.owner));
    const meta = shadowParityLogMeta(fakeSession("owner"), compareToCode("owner", dbMap));
    expect(meta).toEqual({
      category: "authz_shadow_parity",
      role: "owner",
      orgId: "org-1",
      match: true,
      counts: { match: meta.counts.match, code_allow_db_deny: 0, code_deny_db_allow: 0, scope_mismatch: 0 },
    });
    // no permission-key lists, no PII fields leak into the log meta
    expect(Object.keys(meta).sort()).toEqual(["category", "counts", "match", "orgId", "role"]);
  });
});
