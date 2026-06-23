import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type {
  Client,
  ClientContact,
  UserRole,
} from "@/server/db/domain.types";
import { ForbiddenError, NotFoundError } from "@/server/errors/app-error";

vi.mock("@/server/repositories/clients.repository", () => ({
  findByIdAndOrgId: vi.fn(),
}));
vi.mock("@/server/repositories/client-contacts.repository", () => ({
  findManyByClientId: vi.fn(),
  findByIdAndClientId: vi.fn(),
  create: vi.fn(),
  updateByIdAndClientId: vi.fn(),
  deleteByIdAndClientId: vi.fn(),
}));

import * as clientsRepo from "@/server/repositories/clients.repository";
import * as contactsRepo from "@/server/repositories/client-contacts.repository";
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
} from "@/server/services/client-contacts.service";

const ORG = "org-1";
const CLIENT = "c1";
const CONTACT = "ct1";

function makeSession(role: UserRole): FullSession {
  return {
    user: { id: `${role}-user` },
    profile: { id: `${role}-user`, role, full_name: "U", email: "u@x.test" },
    organization: { id: ORG, name: "Org" },
    activeOrg: { id: ORG, name: "Org" },
    activeRole: role,
  } as unknown as FullSession;
}

function clientRow(): Client {
  return {
    id: CLIENT,
    org_id: ORG,
    name: "Acme",
    business_type: null,
    tax_id: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    is_active: true,
    created_by: "owner-user",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as unknown as Client;
}

function contactRow(): ClientContact {
  return {
    id: CONTACT,
    client_id: CLIENT,
    name: "Jane",
    role: null,
    phone: null,
    email: null,
    is_primary: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as unknown as ClientContact;
}

const ROLES = ["owner", "admin", "employee"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue(clientRow());
  vi.mocked(contactsRepo.findManyByClientId).mockResolvedValue([]);
  vi.mocked(contactsRepo.findByIdAndClientId).mockResolvedValue(contactRow());
  vi.mocked(contactsRepo.create).mockResolvedValue(contactRow());
  vi.mocked(contactsRepo.updateByIdAndClientId).mockResolvedValue(contactRow());
  vi.mocked(contactsRepo.deleteByIdAndClientId).mockResolvedValue(true);
});

describe("contacts read/create/edit — all roles (scope inherited from parent client)", () => {
  it.each(ROLES)("%s can list contacts under a client in the org", async (role) => {
    await expect(listContacts(makeSession(role), CLIENT)).resolves.toEqual({
      items: [],
    });
    expect(clientsRepo.findByIdAndOrgId).toHaveBeenCalledWith(CLIENT, ORG);
  });
  it.each(ROLES)("%s can get a contact", async (role) => {
    const dto = await getContact(makeSession(role), CLIENT, CONTACT);
    expect(dto.id).toBe(CONTACT);
  });
  it.each(ROLES)("%s can create a contact", async (role) => {
    const dto = await createContact(makeSession(role), CLIENT, {
      name: "Jane",
    } as Parameters<typeof createContact>[2]);
    expect(dto.id).toBe(CONTACT);
  });
  it.each(ROLES)("%s can edit a contact", async (role) => {
    const dto = await updateContact(makeSession(role), CLIENT, CONTACT, {
      name: "J2",
    } as Parameters<typeof updateContact>[3]);
    expect(dto.id).toBe(CONTACT);
  });
});

describe("parent-client validation (server-trusted, not client-supplied)", () => {
  it("cross-org / non-existent parent client → NotFound (no existence leak)", async () => {
    vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(
      listContacts(makeSession("owner"), "ghost"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
  it("a contact under the wrong parent client → NotFound", async () => {
    vi.mocked(contactsRepo.findByIdAndClientId).mockResolvedValue(null);
    await expect(
      getContact(makeSession("owner"), CLIENT, "other-clients-contact"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("contacts.delete — Owner/Manager only (intentional behavior change)", () => {
  it.each(["owner", "admin"] as const)("%s can delete (hard delete)", async (role) => {
    await expect(
      deleteContact(makeSession(role), CLIENT, CONTACT),
    ).resolves.toBeUndefined();
    // Confirms the HARD delete repo method is still used (unchanged mechanism).
    expect(contactsRepo.deleteByIdAndClientId).toHaveBeenCalledWith(
      CONTACT,
      CLIENT,
    );
  });

  it("employee CANNOT delete — denied before any read; nothing loaded or deleted", async () => {
    await expect(
      deleteContact(makeSession("employee"), CLIENT, CONTACT),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(clientsRepo.findByIdAndOrgId).not.toHaveBeenCalled();
    expect(contactsRepo.deleteByIdAndClientId).not.toHaveBeenCalled();
  });

  it("employee denial is generic and leaks no internals", async () => {
    let thrown: unknown;
    try {
      await deleteContact(makeSession("employee"), CLIENT, CONTACT);
    } catch (e) {
      thrown = e;
    }
    const err = thrown as ForbiddenError;
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.status).toBe(403);
    expect(err.message).not.toContain("contacts.delete");
    expect(err.message).not.toContain("employee");
    expect(err.message).not.toContain(CLIENT);
    expect(err.message).not.toContain(CONTACT);
  });

  it("owner deleting under a cross-org parent → NotFound", async () => {
    vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(
      deleteContact(makeSession("owner"), "ghost", CONTACT),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("owner deleting a contact not under the client → NotFound", async () => {
    vi.mocked(contactsRepo.deleteByIdAndClientId).mockResolvedValue(false);
    await expect(
      deleteContact(makeSession("owner"), CLIENT, "wrong"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
