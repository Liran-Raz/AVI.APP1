import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock every getCurrentSession dependency so we can drive the cutover/shadow
// wiring deterministically. The DB-role resolver is REAL here (only its inputs —
// the env flags and the supabase RPC — are controlled), so this is a true
// integration test of the fail-closed authoritative path.
vi.mock("@/server/auth/supabase-auth.adapter", () => ({
  authAdapter: { getCurrentUser: vi.fn(), getCurrentUserWithMfa: vi.fn() },
}));
vi.mock("@/server/auth/active-org-cookie", () => ({
  readActiveOrgCookie: vi.fn(),
}));
vi.mock("@/server/repositories/profile.repository", () => ({
  findByUserId: vi.fn(),
}));
vi.mock("@/server/repositories/organization.repository", () => ({
  findByIds: vi.fn(),
}));
vi.mock("@/server/repositories/memberships.repository", () => ({
  findByUserId: vi.fn(),
}));
vi.mock("@/server/db/supabase", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  getCurrentSession,
  requireSession,
  requireUserMfaSettled,
} from "./session";
import { authAdapter } from "@/server/auth/supabase-auth.adapter";
import { readActiveOrgCookie } from "@/server/auth/active-org-cookie";
import * as profileRepo from "@/server/repositories/profile.repository";
import * as organizationRepo from "@/server/repositories/organization.repository";
import * as membershipsRepo from "@/server/repositories/memberships.repository";
import { createSupabaseServerClient } from "@/server/db/supabase";
import {
  DB_ROLE_AUTHORITATIVE_ENV,
  DB_ROLE_SHADOW_ENV,
} from "./db-role-resolver";

const getCurrentUserMock = vi.mocked(authAdapter.getCurrentUser);
const getCurrentUserWithMfaMock = vi.mocked(authAdapter.getCurrentUserWithMfa);
const readCookieMock = vi.mocked(readActiveOrgCookie);
const findProfileMock = vi.mocked(profileRepo.findByUserId);
const findOrgsMock = vi.mocked(organizationRepo.findByIds);
const findMembershipsMock = vi.mocked(membershipsRepo.findByUserId);
const createClientMock = vi.mocked(createSupabaseServerClient);

type RpcRow = {
  role_key: string;
  is_system: boolean;
  permission_key: string | null;
  record_scope: string | null;
};

let rpcCalls = 0;
function setRpc(result: {
  data?: RpcRow[] | null;
  error?: { message: string } | null;
}) {
  rpcCalls = 0;
  createClientMock.mockResolvedValue({
    rpc: () => {
      rpcCalls++;
      return Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
      });
    },
  } as never);
}

// DEV-013: getCurrentSession reads the user + MFA state through ONE
// combined adapter call. `pending` drives both the derived user flag and
// the session's mfaPending.
function setMfaState({ pending }: { pending: boolean }) {
  getCurrentUserWithMfaMock.mockResolvedValue({
    user: {
      id: "user-1",
      email: "u@e.t",
      emailConfirmedAt: null,
      metadata: {},
      hasVerifiedTotp: pending,
    },
    currentLevel: "aal1",
    mfaPending: pending,
  } as never);
}

function setupValidOwnerSession() {
  getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "u@e.t" } as never);
  setMfaState({ pending: false });
  findProfileMock.mockResolvedValue({
    id: "user-1",
    full_name: "U",
    email: "u@e.t",
  } as never);
  findMembershipsMock.mockResolvedValue([
    { user_id: "user-1", org_id: "org-1", role: "owner", is_active: true },
  ] as never);
  findOrgsMock.mockResolvedValue([
    { id: "org-1", name: "Org", org_code: "ORG1" },
  ] as never);
  readCookieMock.mockResolvedValue(null as never);
}

const grantRow = (key: string, scope: string | null): RpcRow => ({
  role_key: "owner",
  is_system: true,
  permission_key: key,
  record_scope: scope,
});

let savedAuth: string | undefined;
let savedShadow: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  savedAuth = process.env[DB_ROLE_AUTHORITATIVE_ENV];
  savedShadow = process.env[DB_ROLE_SHADOW_ENV];
  delete process.env[DB_ROLE_AUTHORITATIVE_ENV];
  delete process.env[DB_ROLE_SHADOW_ENV];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  setupValidOwnerSession();
  setRpc({ data: [] });
});
afterEach(() => {
  if (savedAuth === undefined) delete process.env[DB_ROLE_AUTHORITATIVE_ENV];
  else process.env[DB_ROLE_AUTHORITATIVE_ENV] = savedAuth;
  if (savedShadow === undefined) delete process.env[DB_ROLE_SHADOW_ENV];
  else process.env[DB_ROLE_SHADOW_ENV] = savedShadow;
  vi.restoreAllMocks();
});

describe("getCurrentSession — DB-authoritative cutover wiring (fail-closed)", () => {
  it("authoritative OFF: grantMap undefined (legacy ROLE_GRANTS), RPC not called", async () => {
    const s = await getCurrentSession();
    expect(s?.grantMap).toBeUndefined();
    expect(rpcCalls).toBe(0);
  });

  it("authoritative ON + RPC success: grantMap = the resolved DB map", async () => {
    process.env[DB_ROLE_AUTHORITATIVE_ENV] = "1";
    setRpc({ data: [grantRow("team.view", null), grantRow("clients.view", "all")] });
    const s = await getCurrentSession();
    expect(s?.grantMap).toEqual({ "team.view": true, "clients.view": "all" });
    expect(rpcCalls).toBe(1);
  });

  it("authoritative ON + RPC error: grantMap = {} (DENY-ALL, never legacy)", async () => {
    process.env[DB_ROLE_AUTHORITATIVE_ENV] = "1";
    setRpc({ error: { message: "permission denied" } });
    const s = await getCurrentSession();
    expect(s?.grantMap).toEqual({}); // not undefined => no legacy fallback
  });

  it("authoritative ON + zero rows: grantMap = {} (DENY-ALL)", async () => {
    process.env[DB_ROLE_AUTHORITATIVE_ENV] = "1";
    setRpc({ data: [] });
    const s = await getCurrentSession();
    expect(s?.grantMap).toEqual({});
  });

  it("authoritative ON + malformed/unknown grant: grantMap = {} (DENY-ALL)", async () => {
    process.env[DB_ROLE_AUTHORITATIVE_ENV] = "1";
    setRpc({ data: [grantRow("bogus.permission", null)] });
    const s = await getCurrentSession();
    expect(s?.grantMap).toEqual({});
  });

  it("authoritative ON + valid zero-permission sentinel: grantMap = {} (empty authoritative map)", async () => {
    process.env[DB_ROLE_AUTHORITATIVE_ENV] = "1";
    setRpc({
      data: [
        { role_key: "owner", is_system: true, permission_key: null, record_scope: null },
      ],
    });
    const s = await getCurrentSession();
    expect(s?.grantMap).toEqual({});
  });

  it("authoritative ON + role identity mismatch (role_key != enum): grantMap = {} (DENY-ALL)", async () => {
    process.env[DB_ROLE_AUTHORITATIVE_ENV] = "1";
    setRpc({
      data: [
        { role_key: "admin", is_system: true, permission_key: "team.view", record_scope: null },
      ],
    });
    const s = await getCurrentSession();
    expect(s?.grantMap).toEqual({}); // owner session, admin role_key => fail-closed
  });

  it("authoritative ON + custom role (is_system=false): grantMap = {} (Decision A, DENY-ALL)", async () => {
    process.env[DB_ROLE_AUTHORITATIVE_ENV] = "1";
    setRpc({
      data: [
        { role_key: "r_custom", is_system: false, permission_key: "team.view", record_scope: null },
      ],
    });
    const s = await getCurrentSession();
    expect(s?.grantMap).toEqual({});
  });

  it("BOTH flags ON: a SINGLE RPC is issued (reused for shadow, not two calls)", async () => {
    process.env[DB_ROLE_AUTHORITATIVE_ENV] = "1";
    process.env[DB_ROLE_SHADOW_ENV] = "1";
    setRpc({ data: [grantRow("team.view", null)] });
    const s = await getCurrentSession();
    expect(s?.grantMap).toEqual({ "team.view": true });
    expect(rpcCalls).toBe(1);
  });

  it("shadow ON only: grantMap undefined (observational, never authoritative)", async () => {
    process.env[DB_ROLE_SHADOW_ENV] = "1";
    setRpc({ data: [grantRow("roles.manage", null)] });
    const s = await getCurrentSession();
    expect(s?.grantMap).toBeUndefined();
  });
});

describe("MFA gating (DEV-013)", () => {
  it("mfaPending=false propagates onto the full session", async () => {
    const s = await getCurrentSession();
    expect(s?.mfaPending).toBe(false);
    expect(s?.activeOrg).not.toBeNull();
  });

  it("mfaPending=true propagates on the FULL-session branch", async () => {
    setMfaState({ pending: true });
    const s = await getCurrentSession();
    expect(s?.mfaPending).toBe(true);
    expect(s?.activeOrg).not.toBeNull();
  });

  it("mfaPending=true propagates on the office-less branch too", async () => {
    setMfaState({ pending: true });
    findProfileMock.mockResolvedValue(null as never);
    findMembershipsMock.mockResolvedValue([] as never);
    const s = await getCurrentSession();
    expect(s?.mfaPending).toBe(true);
    expect(s?.activeOrg).toBeNull();
  });

  it("requireSession THROWS MFA_REQUIRED (401) while pending", async () => {
    setMfaState({ pending: true });
    await expect(requireSession()).rejects.toMatchObject({
      code: "MFA_REQUIRED",
      status: 401,
    });
  });

  it("requireSession passes a settled (non-pending) session", async () => {
    const s = await requireSession();
    expect(s.activeRole).toBe("owner");
    expect(s.mfaPending).toBe(false);
  });

  it("requireUserMfaSettled: MFA_REQUIRED while pending, user when settled", async () => {
    setMfaState({ pending: true });
    await expect(requireUserMfaSettled()).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    setMfaState({ pending: false });
    const u = await requireUserMfaSettled();
    expect(u.id).toBe("user-1");
  });

  it("requireUserMfaSettled: plain UNAUTHORIZED when no user at all", async () => {
    getCurrentUserWithMfaMock.mockResolvedValue(null);
    await expect(requireUserMfaSettled()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
