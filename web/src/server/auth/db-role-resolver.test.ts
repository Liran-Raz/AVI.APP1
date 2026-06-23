import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FullSession } from "@/server/auth/session";
import type { UserRole } from "@/server/db/domain.types";
import { createSupabaseServerClient } from "@/server/db/supabase";
import { ROLE_GRANTS, type GrantMap } from "./permission-grants";
import {
  DB_ROLE_SHADOW_ENV,
  buildGrantMapFromRows,
  compareToCode,
  isDbRoleShadowEnabled,
  loadDbRoleGrantRows,
  resolveDbRoleGrants,
  runShadowParity,
  shadowParityLogMeta,
  type RolePermissionRow,
} from "./db-role-resolver";

vi.mock("@/server/db/supabase", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const createSupabaseServerClientMock = vi.mocked(createSupabaseServerClient);

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type FakeTable = "organization_memberships" | "roles" | "role_permissions";
type FakeScenario = {
  membership?: unknown;
  membershipError?: QueryError;
  role?: unknown;
  roleError?: QueryError;
  permissions?: unknown[] | null;
  permissionsError?: QueryError;
};

class FakeQuery {
  readonly filters: Array<{ column: string; value: string | boolean }> = [];

  constructor(
    private readonly table: FakeTable,
    private readonly scenario: FakeScenario,
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: string | boolean): this {
    this.filters.push({ column, value });
    return this;
  }

  maybeSingle(): Promise<QueryResult<unknown>> {
    if (this.table === "organization_memberships") {
      return Promise.resolve({
        data: this.scenario.membership ?? null,
        error: this.scenario.membershipError ?? null,
      });
    }
    if (this.table === "roles") {
      return Promise.resolve({
        data: this.scenario.role ?? null,
        error: this.scenario.roleError ?? null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }

  then<TResult1 = QueryResult<unknown[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult<unknown[]>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.many()).then(onfulfilled, onrejected);
  }

  private many(): QueryResult<unknown[]> {
    if (this.table !== "role_permissions") return { data: [], error: null };
    return {
      data: this.scenario.permissions ?? [],
      error: this.scenario.permissionsError ?? null,
    };
  }
}

function useFakeSupabase(scenario: FakeScenario): FakeQuery[] {
  const queries: FakeQuery[] = [];
  createSupabaseServerClientMock.mockResolvedValue({
    from(table: FakeTable) {
      const query = new FakeQuery(table, scenario);
      queries.push(query);
      return query;
    },
  } as never);
  return queries;
}

function fakeSession(role: UserRole): FullSession {
  return {
    user: { id: "user-1" },
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
  createSupabaseServerClientMock.mockReset();
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

describe("resolveDbRoleGrants", () => {
  it("scopes by authenticated user, active org membership and role_id", async () => {
    const queries = useFakeSupabase({
      membership: {
        role_id: "role-1",
        org_id: "org-1",
        is_active: true,
      },
      role: { id: "role-1", org_id: "org-1" },
      permissions: [
        { permission_key: "team.view", record_scope: null },
        { permission_key: "clients.view", record_scope: "all" },
      ],
    });

    const result = await resolveDbRoleGrants(fakeSession("owner"));

    expect(result).toEqual({
      ok: true,
      rows: [
        { permission_key: "team.view", record_scope: null },
        { permission_key: "clients.view", record_scope: "all" },
      ],
      grantMap: {
        "team.view": true,
        "clients.view": "all",
      },
    });
    expect(queries[0]?.filters).toEqual([
      { column: "user_id", value: "user-1" },
      { column: "org_id", value: "org-1" },
      { column: "is_active", value: true },
    ]);
    expect(queries[1]?.filters).toEqual([{ column: "id", value: "role-1" }]);
    expect(queries[2]?.filters).toEqual([
      { column: "role_id", value: "role-1" },
    ]);
  });

  it("fails closed when membership lookup errors", async () => {
    useFakeSupabase({ membershipError: { message: "query failed" } });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "membership_query_error",
    });
  });

  it("fails closed when membership is missing", async () => {
    useFakeSupabase({ membership: null });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "missing_membership",
    });
  });

  it("fails closed when membership is inactive", async () => {
    useFakeSupabase({
      membership: { role_id: "role-1", org_id: "org-1", is_active: false },
    });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "inactive_membership",
    });
  });

  it("fails closed when role_id is missing", async () => {
    useFakeSupabase({
      membership: { role_id: null, org_id: "org-1", is_active: true },
    });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "missing_role_id",
    });
  });

  it("fails closed when role lookup errors", async () => {
    useFakeSupabase({
      membership: { role_id: "role-1", org_id: "org-1", is_active: true },
      roleError: { message: "query failed" },
    });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "role_query_error",
    });
  });

  it("fails closed when role is missing", async () => {
    useFakeSupabase({
      membership: { role_id: "role-1", org_id: "org-1", is_active: true },
      role: null,
    });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "missing_role",
    });
  });

  it("fails closed when role belongs to another org", async () => {
    useFakeSupabase({
      membership: { role_id: "role-1", org_id: "org-1", is_active: true },
      role: { id: "role-1", org_id: "org-2" },
    });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "role_org_mismatch",
    });
  });

  it("fails closed when permission lookup errors", async () => {
    useFakeSupabase({
      membership: { role_id: "role-1", org_id: "org-1", is_active: true },
      role: { id: "role-1", org_id: "org-1" },
      permissionsError: { message: "query failed" },
    });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "permissions_query_error",
    });
  });

  it("fails closed when permission rows are malformed", async () => {
    useFakeSupabase({
      membership: { role_id: "role-1", org_id: "org-1", is_active: true },
      role: { id: "role-1", org_id: "org-1" },
      permissions: [{ permission_key: "team.view", record_scope: 123 }],
    });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "malformed_permission_row",
    });
  });

  it("fails closed when permission rows are ambiguous", async () => {
    useFakeSupabase({
      membership: { role_id: "role-1", org_id: "org-1", is_active: true },
      role: { id: "role-1", org_id: "org-1" },
      permissions: [
        { permission_key: "team.view", record_scope: null },
        { permission_key: "team.view", record_scope: null },
      ],
    });

    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "ambiguous_permission_rows",
    });
  });

  it("exposes a fail-closed row loader for shadow parity", async () => {
    useFakeSupabase({
      membership: { role_id: null, org_id: "org-1", is_active: true },
    });

    await expect(loadDbRoleGrantRows(fakeSession("owner"))).resolves.toEqual(
      [],
    );
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
