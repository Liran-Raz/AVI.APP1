import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FullSession } from "@/server/auth/session";
import type { UserRole } from "@/server/db/domain.types";
import { createSupabaseServerClient } from "@/server/db/supabase";
import { can } from "./authorization";
import { PERMISSIONS } from "./permissions";
import { ROLE_GRANTS, type GrantMap } from "./permission-grants";
import {
  DB_ROLE_SHADOW_ENV,
  authoritativeGrantMap,
  buildGrantMapFromRows,
  compareToCode,
  isDbRoleShadowEnabled,
  resolveDbRoleGrants,
  runShadowParity,
  shadowParityLogMeta,
  type DbRoleResolveResult,
  type DbRoleResolver,
  type RolePermissionRow,
} from "./db-role-resolver";

vi.mock("@/server/db/supabase", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const createSupabaseServerClientMock = vi.mocked(createSupabaseServerClient);

// ---- Fake of the secure read RPC (migration 0014) --------------------------
// The resolver's ONLY DB call is supabase.rpc("resolve_my_role_permissions",
// { p_org_id }). We fake that single surface and capture the call.
type RpcRow = {
  role_key: string;
  is_system: boolean;
  permission_key: string | null;
  record_scope: string | null;
};
type RpcResult = { data: RpcRow[] | null; error: { message: string } | null };

let lastRpc: { fn: string; args: unknown } | null = null;

function useFakeRpc(opts: {
  data?: RpcRow[] | null;
  error?: { message: string } | null;
  reject?: boolean;
  hang?: boolean;
}) {
  lastRpc = null;
  createSupabaseServerClientMock.mockResolvedValue({
    rpc(fn: string, args: unknown): Promise<RpcResult> {
      lastRpc = { fn, args };
      if (opts.reject) return Promise.reject(new Error("rejected"));
      // never resolves — exercises the bounded-timeout path
      if (opts.hang) return new Promise<RpcResult>(() => {});
      return Promise.resolve({
        data: opts.data ?? null,
        error: opts.error ?? null,
      });
    },
  } as never);
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

// Build full RPC rows (role_key/is_system + grant) from a grant map.
function rpcRowsFromGrantMap(role: string, map: GrantMap): RpcRow[] {
  return Object.entries(map).map(([permission_key, v]) => ({
    role_key: role,
    is_system: true,
    permission_key,
    record_scope: v === true ? null : (v as string),
  }));
}

// One grant row with explicit fields (for validation cases).
function grantRow(
  permission_key: string,
  record_scope: string | null,
): RpcRow {
  return { role_key: "owner", is_system: true, permission_key, record_scope };
}

// The zero-permission sentinel the RPC emits for a valid role with no grants.
const sentinelRows: RpcRow[] = [
  { role_key: "employee", is_system: true, permission_key: null, record_scope: null },
];

// Each test starts with the flag unset; restore the original afterward.
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[DB_ROLE_SHADOW_ENV];
  delete process.env[DB_ROLE_SHADOW_ENV];
  createSupabaseServerClientMock.mockReset();
  lastRpc = null;
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

describe("runShadowParity", () => {
  it("returns {enabled:false} and NEVER resolves when disabled", async () => {
    let called = false;
    const resolve: DbRoleResolver = async () => {
      called = true;
      return { ok: true, rows: [], grantMap: {} };
    };
    const out = await runShadowParity(fakeSession("owner"), resolve);
    expect(out).toEqual({ enabled: false });
    expect(called).toBe(false); // zero RPC calls when disabled
  });

  it("reports parity when enabled and resolution succeeds", async () => {
    process.env[DB_ROLE_SHADOW_ENV] = "1";
    const rows = rowsFromGrantMap(ROLE_GRANTS.owner);
    const resolve: DbRoleResolver = async () => ({
      ok: true,
      rows,
      grantMap: buildGrantMapFromRows(rows),
    });
    const out = await runShadowParity(fakeSession("owner"), resolve);
    expect(out).toMatchObject({ enabled: true, ok: true });
    if (out.enabled && out.ok) expect(out.parity.match).toBe(true);
  });

  it("preserves the DB failure reason (not an empty parity) when enabled", async () => {
    process.env[DB_ROLE_SHADOW_ENV] = "1";
    const resolve: DbRoleResolver = async () => ({
      ok: false,
      reason: "rpc_error",
    });
    const out = await runShadowParity(fakeSession("owner"), resolve);
    expect(out).toEqual({
      enabled: true,
      ok: false,
      reason: "rpc_error",
    });
  });

  it("fails closed (does not throw) when the resolver throws", async () => {
    process.env[DB_ROLE_SHADOW_ENV] = "1";
    const resolve: DbRoleResolver = async () => {
      throw new Error("boom");
    };
    const out = await runShadowParity(fakeSession("owner"), resolve);
    expect(out).toEqual({
      enabled: true,
      ok: false,
      reason: "unexpected_error",
    });
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

describe("resolveDbRoleGrants (via the 0014 RPC)", () => {
  it("calls the RPC with the active org id and maps the returned grants", async () => {
    useFakeRpc({
      data: rpcRowsFromGrantMap("owner", {
        "team.view": true,
        "clients.view": "all",
      }),
    });

    const result = await resolveDbRoleGrants(fakeSession("owner"));

    expect(result).toEqual({
      ok: true,
      rows: [
        { permission_key: "team.view", record_scope: null },
        { permission_key: "clients.view", record_scope: "all" },
      ],
      grantMap: { "team.view": true, "clients.view": "all" },
    });
    // server-side scoping: only p_org_id is passed; identity comes from auth.uid()
    expect(lastRpc?.fn).toBe("resolve_my_role_permissions");
    expect(lastRpc?.args).toEqual({ p_org_id: "org-1" });
  });

  it("treats the zero-permission sentinel (single null row) as success with empty grants", async () => {
    useFakeRpc({ data: sentinelRows });
    await expect(resolveDbRoleGrants(fakeSession("employee"))).resolves.toEqual({
      ok: true,
      rows: [],
      grantMap: {},
    });
  });

  it("fails closed (missing_membership) when the RPC returns zero rows", async () => {
    useFakeRpc({ data: [] });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "missing_membership",
    });
  });

  it("fails closed (missing_membership) when the RPC returns null data", async () => {
    useFakeRpc({ data: null });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "missing_membership",
    });
  });

  it("fails closed (rpc_error) when the RPC returns an error", async () => {
    useFakeRpc({ error: { message: "permission denied" } });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "rpc_error",
    });
  });

  it("fails closed (unexpected_error) when the RPC call rejects", async () => {
    useFakeRpc({ reject: true });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "unexpected_error",
    });
  });

  it("fails closed (unexpected_error) when client creation throws", async () => {
    createSupabaseServerClientMock.mockRejectedValue(new Error("boom"));
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "unexpected_error",
    });
  });

  it("fails closed (timeout) when the RPC exceeds the bounded timeout", async () => {
    useFakeRpc({ hang: true });
    await expect(
      resolveDbRoleGrants(fakeSession("owner"), { timeoutMs: 5 }),
    ).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("rejects a malformed permission row (no silent drop)", async () => {
    useFakeRpc({
      data: [grantRow("team.view", 123 as unknown as string)],
    });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "malformed_permission_row",
    });
  });

  it("rejects an unknown permission key", async () => {
    useFakeRpc({ data: [grantRow("bogus.permission", null)] });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "unknown_permission_key",
    });
  });

  it("rejects an ownership.transfer grant", async () => {
    useFakeRpc({ data: [grantRow("ownership.transfer", null)] });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "ownership_permission",
    });
  });

  it("rejects a scoped permission with no scope", async () => {
    useFakeRpc({ data: [grantRow("clients.view", null)] });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "missing_scope",
    });
  });

  it("rejects an unsupported record scope", async () => {
    useFakeRpc({ data: [grantRow("clients.view", "bogus")] });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "invalid_scope",
    });
  });

  it("rejects a scope on a contextless permission", async () => {
    useFakeRpc({ data: [grantRow("team.view", "all")] });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "unexpected_scope",
    });
  });

  it("rejects duplicate permission keys, even with differing scopes", async () => {
    useFakeRpc({
      data: [grantRow("clients.view", "all"), grantRow("clients.view", "own")],
    });
    await expect(resolveDbRoleGrants(fakeSession("owner"))).resolves.toEqual({
      ok: false,
      reason: "ambiguous_permission_rows",
    });
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
    const meta = shadowParityLogMeta(
      fakeSession("owner"),
      compareToCode("owner", dbMap),
    );
    expect(meta).toEqual({
      category: "authz_shadow_parity",
      role: "owner",
      orgId: "org-1",
      match: true,
      counts: {
        match: meta.counts.match,
        code_allow_db_deny: 0,
        code_deny_db_allow: 0,
        scope_mismatch: 0,
      },
    });
    expect(Object.keys(meta).sort()).toEqual([
      "category",
      "counts",
      "match",
      "orgId",
      "role",
    ]);
  });
});

describe("DB resolver is non-authoritative", () => {
  it("authoritative can() is driven by ROLE_GRANTS, not the DB resolver", () => {
    expect(can(fakeSession("owner"), PERMISSIONS.ROLES_MANAGE)).toBe(true);
    expect(can(fakeSession("employee"), PERMISSIONS.ROLES_MANAGE)).toBe(false);
  });

  it("an escalating shadow result never changes the authoritative decision", async () => {
    process.env[DB_ROLE_SHADOW_ENV] = "1";
    const escalating: DbRoleResolver = async () => ({
      ok: true,
      rows: [{ permission_key: "roles.manage", record_scope: null }],
      grantMap: { "roles.manage": true },
    });
    const out = await runShadowParity(fakeSession("employee"), escalating);
    expect(out).toMatchObject({ enabled: true, ok: true });
    if (out.enabled && out.ok) {
      expect(out.parity.counts.code_deny_db_allow).toBe(1); // flagged for review
    }
    // ...but the authoritative decision is unaffected by the DB/shadow result.
    expect(can(fakeSession("employee"), PERMISSIONS.ROLES_MANAGE)).toBe(false);
  });
});

describe("authoritativeGrantMap (fail-closed cutover)", () => {
  it("returns the resolved grants on success", () => {
    const r: DbRoleResolveResult = {
      ok: true,
      rows: [{ permission_key: "team.view", record_scope: null }],
      grantMap: { "team.view": true },
    };
    expect(authoritativeGrantMap(r)).toEqual({ "team.view": true });
  });

  it("returns an EMPTY map for the zero-permission sentinel (not a fallback)", () => {
    expect(authoritativeGrantMap({ ok: true, rows: [], grantMap: {} })).toEqual(
      {},
    );
  });

  it("returns DENY-ALL ({}) for EVERY failure reason — never the legacy map", () => {
    const failureReasons = [
      "unexpected_error",
      "timeout",
      "rpc_error",
      "missing_membership",
      "malformed_permission_row",
      "ambiguous_permission_rows",
      "unknown_permission_key",
      "ownership_permission",
      "missing_scope",
      "invalid_scope",
      "unexpected_scope",
    ] as const;
    for (const reason of failureReasons) {
      expect(authoritativeGrantMap({ ok: false, reason })).toEqual({});
    }
  });
});
