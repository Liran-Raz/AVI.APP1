import "server-only";

import type { FullSession } from "@/server/auth/session";
import * as clientsRepo from "@/server/repositories/clients.repository";
import type { Client, Database } from "@/server/db/database.types";

type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
import { ForbiddenError, NotFoundError } from "@/server/errors/app-error";
import type {
  CreateClientPayload,
  ListClientsQuery,
  UpdateClientPayload,
} from "@/server/validators/clients.schema";

// ============================================================
// DTO — what the API actually exposes to the client.
// We intentionally drop `org_id` (implicit — caller's own org) and
// `created_by` (audit-only for now). Field names are camelCase, ISO
// timestamps as strings.
// ============================================================

export type ClientDTO = {
  id: string;
  name: string;
  businessType: Client["business_type"];
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function toDTO(row: Client): ClientDTO {
  return {
    id: row.id,
    name: row.name,
    businessType: row.business_type,
    taxId: row.tax_id,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Authorization helpers
// ============================================================

function assertCanArchive(session: FullSession): void {
  const role = session.profile.role;
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenError("Only owner or admin can archive or restore clients");
  }
}

// ============================================================
// Public API
// ============================================================

export async function listClients(
  session: FullSession,
  query: ListClientsQuery,
): Promise<{ items: ClientDTO[] }> {
  const rows = await clientsRepo.findManyByOrgId(session.organization.id, {
    search: query.search,
    businessType: query.businessType,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toDTO) };
}

export async function getClient(
  session: FullSession,
  id: string,
): Promise<ClientDTO> {
  const row = await clientsRepo.findByIdAndOrgId(id, session.organization.id);
  if (!row) throw new NotFoundError("Client not found");
  return toDTO(row);
}

export async function createClient(
  session: FullSession,
  input: CreateClientPayload,
): Promise<ClientDTO> {
  const row = await clientsRepo.create({
    org_id: session.organization.id,
    created_by: session.profile.id,
    name: input.name,
    business_type: input.businessType ?? null,
    tax_id: input.taxId ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
  });
  return toDTO(row);
}

export async function updateClient(
  session: FullSession,
  id: string,
  patch: UpdateClientPayload,
): Promise<ClientDTO> {
  // Build a snake_case partial. Only include keys the caller explicitly sent
  // (zod leaves omitted keys as `undefined`). Null is meaningful — it clears
  // the field — and is preserved.
  const dbPatch: ClientUpdate = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.businessType !== undefined) dbPatch.business_type = patch.businessType;
  if (patch.taxId !== undefined) dbPatch.tax_id = patch.taxId;
  if (patch.email !== undefined) dbPatch.email = patch.email;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone;
  if (patch.address !== undefined) dbPatch.address = patch.address;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;

  const row = await clientsRepo.updateByIdAndOrgId(
    id,
    session.organization.id,
    dbPatch,
  );
  if (!row) throw new NotFoundError("Client not found");
  return toDTO(row);
}

export async function archiveClient(
  session: FullSession,
  id: string,
): Promise<ClientDTO> {
  assertCanArchive(session);
  const row = await clientsRepo.setActiveStatus(id, session.organization.id, false);
  if (!row) throw new NotFoundError("Client not found");
  return toDTO(row);
}

export async function restoreClient(
  session: FullSession,
  id: string,
): Promise<ClientDTO> {
  assertCanArchive(session);
  const row = await clientsRepo.setActiveStatus(id, session.organization.id, true);
  if (!row) throw new NotFoundError("Client not found");
  return toDTO(row);
}
