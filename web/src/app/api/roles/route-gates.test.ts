import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// API-route integration tests for the custom-roles flag gates + CRUD flows.
// requireSession, the feature flags, and the service are mocked so we exercise
// the ROUTE behavior (flag-gating order + envelope status) in isolation.
vi.mock("@/server/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/auth/role-management.flags", () => ({
  isRoleManagementUiEnabled: vi.fn(() => true),
  isRoleManagementWriteEnabled: vi.fn(() => true),
}));
vi.mock("@/server/services/roles.service", () => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  duplicateRole: vi.fn(),
}));

import { GET, POST } from "@/app/api/roles/route";
import { PATCH, DELETE } from "@/app/api/roles/[id]/route";
import { POST as DUPLICATE } from "@/app/api/roles/[id]/duplicate/route";
import { requireSession } from "@/server/auth/session";
import {
  isRoleManagementUiEnabled,
  isRoleManagementWriteEnabled,
} from "@/server/auth/role-management.flags";
import * as rolesService from "@/server/services/roles.service";

const reqSession = vi.mocked(requireSession);
const uiFlag = vi.mocked(isRoleManagementUiEnabled);
const writeFlag = vi.mocked(isRoleManagementWriteEnabled);
const svc = vi.mocked(rolesService);

const session = { activeOrg: { id: "org-1" } } as never;
const UUID = "11111111-1111-4111-8111-111111111111";
const jsonReq = (body: unknown) =>
  ({ json: async () => body }) as unknown as NextRequest;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  reqSession.mockResolvedValue(session);
  uiFlag.mockReturnValue(true);
  writeFlag.mockReturnValue(true);
});

describe("/api/roles route flag gates + flows", () => {
  it("GET is gated by the UI flag (403 when off; service not called)", async () => {
    uiFlag.mockReturnValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(svc.listRoles).not.toHaveBeenCalled();
  });

  it("GET lists when the UI flag is on (200)", async () => {
    svc.listRoles.mockResolvedValue({ items: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(svc.listRoles).toHaveBeenCalledTimes(1);
  });

  it("POST is gated by the write flag (403 when off; body not parsed, service not called)", async () => {
    writeFlag.mockReturnValue(false);
    const parsed = vi.fn();
    const res = await POST({ json: parsed } as unknown as NextRequest);
    expect(res.status).toBe(403);
    expect(parsed).not.toHaveBeenCalled();
    expect(svc.createRole).not.toHaveBeenCalled();
  });

  it("POST creates when the write flag is on (201)", async () => {
    svc.createRole.mockResolvedValue({ id: "r1" } as never);
    const res = await POST(
      jsonReq({
        name: "Bookkeeper",
        description: null,
        permissions: [{ permissionKey: "team.view" }],
      }),
    );
    expect(res.status).toBe(201);
    expect(svc.createRole).toHaveBeenCalledTimes(1);
  });

  it("PATCH is gated by the write flag (403 when off)", async () => {
    writeFlag.mockReturnValue(false);
    const res = await PATCH(jsonReq({}), ctx(UUID));
    expect(res.status).toBe(403);
    expect(svc.updateRole).not.toHaveBeenCalled();
  });

  it("DELETE is gated by the write flag (403 when off)", async () => {
    writeFlag.mockReturnValue(false);
    const res = await DELETE(jsonReq({}), ctx(UUID));
    expect(res.status).toBe(403);
    expect(svc.deleteRole).not.toHaveBeenCalled();
  });

  it("DELETE removes when the write flag is on (200)", async () => {
    svc.deleteRole.mockResolvedValue(undefined as never);
    const res = await DELETE(jsonReq({}), ctx(UUID));
    expect(res.status).toBe(200);
    expect(svc.deleteRole).toHaveBeenCalledTimes(1);
  });

  it("duplicate is gated by the write flag (403 when off)", async () => {
    writeFlag.mockReturnValue(false);
    const res = await DUPLICATE(jsonReq({ name: "Dup" }), ctx(UUID));
    expect(res.status).toBe(403);
    expect(svc.duplicateRole).not.toHaveBeenCalled();
  });
});
