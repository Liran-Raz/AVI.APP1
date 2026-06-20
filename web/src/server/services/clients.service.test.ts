import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { Client, UserRole } from "@/server/db/database.types";
import { ForbiddenError, NotFoundError } from "@/server/errors/app-error";

// Mock only the repository — its (mocked) module never loads supabase/env.
vi.mock("@/server/repositories/clients.repository", () => ({
  findManyByOrgId: vi.fn(),
  findByIdAndOrgId: vi.fn(),
  create: vi.fn(),
  updateByIdAndOrgId: vi.fn(),
  setActiveStatus: vi.fn(),
}));

import * as clientsRepo from "@/server/repositories/clients.repository";
import {
  archiveClient,
  createClient,
  getClient,
  listClients,
  restoreClient,
  updateClient,
} from "@/server/services/clients.service";

const ORG = "org-1";

function makeSession(role: UserRole): FullSession {
  return {
    user: { id: `${role}-user` },
    profile: { id: `${role}-user`, role, full_name: "U", email: "u@x.test" },
    organization: { id: ORG, name: "Org" },
    activeOrg: { id: ORG, name: "Org" },
    activeRole: role,
  } as unknown as FullSession;
}

function clientRow(o: { isActive?: boolean } = {}): Client {
  return {
    id: "c1",
    org_id: ORG,
    name: "Acme",
    business_type: null,
    tax_id: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    is_active: o.isActive ?? true,
    created_by: "owner-user",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as unknown as Client;
}

const ROLES = ["owner", "admin", "employee"] as const;
const listQuery = { status: "all", limit: 50, offset: 0 } as Parameters<
  typeof listClients
>[1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientsRepo.findManyByOrgId).mockResolvedValue([]);
  vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue(clientRow());
  vi.mocked(clientsRepo.create).mockResolvedValue(clientRow());
  vi.mocked(clientsRepo.updateByIdAndOrgId).mockResolvedValue(clientRow());
  vi.mocked(clientsRepo.setActiveStatus).mockResolvedValue(clientRow());
});

describe("listClients — all roles retain broad visibility (org-scoped)", () => {
  it.each(ROLES)("allows %s and queries the active org", async (role) => {
    await expect(listClients(makeSession(role), listQuery)).resolves.toEqual({
      items: [],
    });
    expect(clientsRepo.findManyByOrgId).toHaveBeenCalledWith(
      ORG,
      expect.anything(),
    );
  });
});

describe("getClient — all roles; org-scoped; cross-org → 404", () => {
  it.each(ROLES)("allows %s for a client in the org", async (role) => {
    const dto = await getClient(makeSession(role), "c1");
    expect(dto.id).toBe("c1");
    expect(clientsRepo.findByIdAndOrgId).toHaveBeenCalledWith("c1", ORG);
  });
  it("cross-org / non-existent client → NotFound", async () => {
    vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(getClient(makeSession("owner"), "ghost")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("createClient / updateClient — all roles (Phase 1 behavior)", () => {
  it.each(ROLES)("%s can create", async (role) => {
    const dto = await createClient(makeSession(role), { name: "X" } as Parameters<
      typeof createClient
    >[1]);
    expect(dto.id).toBe("c1");
  });
  it.each(ROLES)("%s can edit", async (role) => {
    const dto = await updateClient(makeSession(role), "c1", {
      name: "Y",
    } as Parameters<typeof updateClient>[2]);
    expect(dto.id).toBe("c1");
  });
  it("edit of a non-existent client → NotFound", async () => {
    vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(
      updateClient(makeSession("owner"), "ghost", {} as Parameters<
        typeof updateClient
      >[2]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("archiveClient / restoreClient — owner/admin only", () => {
  it.each(["owner", "admin"] as const)("%s can archive", async (role) => {
    const dto = await archiveClient(makeSession(role), "c1");
    expect(dto.id).toBe("c1");
    expect(clientsRepo.setActiveStatus).toHaveBeenCalledWith("c1", ORG, false);
  });
  it.each(["owner", "admin"] as const)("%s can restore", async (role) => {
    await restoreClient(makeSession(role), "c1");
    expect(clientsRepo.setActiveStatus).toHaveBeenCalledWith("c1", ORG, true);
  });
  it("employee CANNOT archive — denied before any read", async () => {
    await expect(
      archiveClient(makeSession("employee"), "c1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(clientsRepo.findByIdAndOrgId).not.toHaveBeenCalled();
    expect(clientsRepo.setActiveStatus).not.toHaveBeenCalled();
  });
  it("employee CANNOT restore — denied before any read", async () => {
    await expect(
      restoreClient(makeSession("employee"), "c1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(clientsRepo.setActiveStatus).not.toHaveBeenCalled();
  });
  it("archive of a non-existent client (owner) → NotFound", async () => {
    vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(
      archiveClient(makeSession("owner"), "ghost"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
