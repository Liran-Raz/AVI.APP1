import { describe, it, expect, vi, beforeEach } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { UserRole } from "@/server/db/domain.types";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";
import * as rolesRepo from "@/server/repositories/roles.repository";
import { isRoleManagementWriteEnabled } from "@/server/auth/role-management.flags";
import * as rolesService from "./roles.service";

vi.mock("@/server/repositories/roles.repository", () => ({
  listOrgRoles: vi.fn(),
  createOrgRole: vi.fn(),
  updateOrgRole: vi.fn(),
  deleteOrgRole: vi.fn(),
  duplicateOrgRole: vi.fn(),
}));
vi.mock("@/server/auth/role-management.flags", () => ({
  isRoleManagementWriteEnabled: vi.fn(() => true),
}));

const repo = vi.mocked(rolesRepo);
const writeFlag = vi.mocked(isRoleManagementWriteEnabled);

// Real authorization (bound to ROLE_GRANTS) drives the role checks.
function session(role: UserRole): FullSession {
  return {
    user: { id: "u1", email: "u@x.test" },
    profile: { id: "u1", org_id: "org-1", role, is_active: true },
    organization: { id: "org-1", name: "Org", org_code: "ORG1" },
    activeOrg: { id: "org-1", name: "Org", org_code: "ORG1" },
    activeRole: role,
    memberships: [],
  } as unknown as FullSession;
}

const flatRows = [
  { role_id: "sys-owner", key: "owner", name: "Owner", description: null, is_system: true, created_at: "t", updated_at: "t", permission_key: "team.view", record_scope: null },
  { role_id: "sys-owner", key: "owner", name: "Owner", description: null, is_system: true, created_at: "t", updated_at: "t", permission_key: "clients.view", record_scope: "all" },
  { role_id: "custom-1", key: "r_abc", name: "Bookkeeper", description: "desc", is_system: false, created_at: "t", updated_at: "t2", permission_key: null, record_scope: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  writeFlag.mockReturnValue(true);
});

describe("listRoles", () => {
  it("owner may list and flattened rows group into DTOs", async () => {
    repo.listOrgRoles.mockResolvedValue(flatRows as never);
    const out = await rolesService.listRoles(session("owner"));
    expect(out.items).toHaveLength(2);
    const owner = out.items.find((r) => r.id === "sys-owner")!;
    expect(owner.isSystem).toBe(true);
    expect(owner.permissions).toHaveLength(2);
    const custom = out.items.find((r) => r.id === "custom-1")!;
    expect(custom.isSystem).toBe(false);
    expect(custom.permissions).toHaveLength(0); // the null-permission sentinel is dropped
  });

  it("manager (admin) may list (roles.view)", async () => {
    repo.listOrgRoles.mockResolvedValue([] as never);
    await expect(rolesService.listRoles(session("admin"))).resolves.toEqual({
      items: [],
    });
  });

  it("employee is denied (no roles.view)", async () => {
    await expect(rolesService.listRoles(session("employee"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repo.listOrgRoles).not.toHaveBeenCalled();
  });
});

describe("write gating (Owner-only + write flag)", () => {
  const input = { name: "Bookkeeper", description: null, permissions: [] };

  it("denies create when the write flag is OFF", async () => {
    writeFlag.mockReturnValue(false);
    await expect(
      rolesService.createRole(session("owner"), input as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.createOrgRole).not.toHaveBeenCalled();
  });

  it("denies a manager (roles.manage is owner-only)", async () => {
    await expect(
      rolesService.createRole(session("admin"), input as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.createOrgRole).not.toHaveBeenCalled();
  });

  it("denies an employee", async () => {
    await expect(
      rolesService.createRole(session("employee"), input as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows an owner and returns the created role", async () => {
    repo.createOrgRole.mockResolvedValue("custom-1");
    repo.listOrgRoles.mockResolvedValue(flatRows as never);
    const dto = await rolesService.createRole(session("owner"), input as never);
    expect(dto.id).toBe("custom-1");
    expect(repo.createOrgRole).toHaveBeenCalledWith("org-1", "Bookkeeper", null, []);
  });

  it("denies update/delete/duplicate for non-owners", async () => {
    await expect(
      rolesService.deleteRole(session("employee"), "custom-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      rolesService.deleteRole(session("admin"), "custom-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      rolesService.duplicateRole(session("admin"), "sys-owner", {
        name: "Copy",
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.deleteOrgRole).not.toHaveBeenCalled();
    expect(repo.duplicateOrgRole).not.toHaveBeenCalled();
  });

  it("owner can delete and duplicate", async () => {
    repo.deleteOrgRole.mockResolvedValue(undefined);
    await expect(
      rolesService.deleteRole(session("owner"), "custom-1"),
    ).resolves.toBeUndefined();
    expect(repo.deleteOrgRole).toHaveBeenCalledWith("org-1", "custom-1");

    repo.duplicateOrgRole.mockResolvedValue("custom-2");
    repo.listOrgRoles.mockResolvedValue([
      { ...flatRows[2], role_id: "custom-2", name: "Copy" },
    ] as never);
    const dto = await rolesService.duplicateRole(session("owner"), "sys-owner", {
      name: "Copy",
    } as never);
    expect(dto.id).toBe("custom-2");
    expect(repo.duplicateOrgRole).toHaveBeenCalledWith("org-1", "sys-owner", "Copy");
  });
});

describe("RPC SQLSTATE -> AppError mapping", () => {
  const cases: Array<[string, new (...a: never[]) => Error]> = [
    ["42501", ForbiddenError],
    ["P0002", NotFoundError],
    ["23505", ConflictError],
    ["55006", ConflictError],
    ["40001", ConflictError],
    ["22000", ValidationError],
    ["22023", ValidationError], // DB-side payload validation (validate_custom_role_payload)
    ["23514", ValidationError],
    ["23502", ValidationError],
  ];
  const input = { name: "X", description: null, permissions: [] };

  for (const [code, ctor] of cases) {
    it(`maps SQLSTATE ${code}`, async () => {
      repo.createOrgRole.mockRejectedValue({ code });
      await expect(
        rolesService.createRole(session("owner"), input as never),
      ).rejects.toBeInstanceOf(ctor);
    });
  }

  it("maps an unknown error to a 500 AppError (no leak)", async () => {
    repo.createOrgRole.mockRejectedValue(new Error("connection reset"));
    await expect(
      rolesService.createRole(session("owner"), input as never),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
    await expect(
      rolesService.createRole(session("owner"), input as never),
    ).rejects.toBeInstanceOf(AppError);
  });
});
