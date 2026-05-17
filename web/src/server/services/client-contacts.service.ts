import "server-only";

import type { FullSession } from "@/server/auth/session";
import * as clientsRepo from "@/server/repositories/clients.repository";
import * as contactsRepo from "@/server/repositories/client-contacts.repository";
import type { ClientContact, Database } from "@/server/db/database.types";
import { NotFoundError } from "@/server/errors/app-error";
import type {
  CreateContactPayload,
  UpdateContactPayload,
} from "@/server/validators/client-contacts.schema";

type ContactUpdate = Database["public"]["Tables"]["client_contacts"]["Update"];

// ============================================================
// DTO
// ============================================================

export type ContactDTO = {
  id: string;
  clientId: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

function toDTO(row: ClientContact): ContactDTO {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    email: row.email,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Helper: verify parent client belongs to caller's org
// ============================================================

async function assertClientInOrg(
  session: FullSession,
  clientId: string,
): Promise<void> {
  const client = await clientsRepo.findByIdAndOrgId(
    clientId,
    session.organization.id,
  );
  if (!client) {
    // Don't reveal whether the client exists in some other org — same
    // pattern as the rest of the service.
    throw new NotFoundError("Client not found");
  }
}

// ============================================================
// Public API
// ============================================================

export async function listContacts(
  session: FullSession,
  clientId: string,
): Promise<{ items: ContactDTO[] }> {
  await assertClientInOrg(session, clientId);
  const rows = await contactsRepo.findManyByClientId(clientId);
  return { items: rows.map(toDTO) };
}

export async function getContact(
  session: FullSession,
  clientId: string,
  contactId: string,
): Promise<ContactDTO> {
  await assertClientInOrg(session, clientId);
  const row = await contactsRepo.findByIdAndClientId(contactId, clientId);
  if (!row) throw new NotFoundError("Contact not found");
  return toDTO(row);
}

export async function createContact(
  session: FullSession,
  clientId: string,
  input: CreateContactPayload,
): Promise<ContactDTO> {
  await assertClientInOrg(session, clientId);
  const row = await contactsRepo.create({
    client_id: clientId,
    name: input.name,
    role: input.role ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    is_primary: input.isPrimary ?? false,
  });
  return toDTO(row);
}

export async function updateContact(
  session: FullSession,
  clientId: string,
  contactId: string,
  patch: UpdateContactPayload,
): Promise<ContactDTO> {
  await assertClientInOrg(session, clientId);
  const dbPatch: ContactUpdate = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.role !== undefined) dbPatch.role = patch.role;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone;
  if (patch.email !== undefined) dbPatch.email = patch.email;
  if (patch.isPrimary !== undefined) dbPatch.is_primary = patch.isPrimary;

  const row = await contactsRepo.updateByIdAndClientId(
    contactId,
    clientId,
    dbPatch,
  );
  if (!row) throw new NotFoundError("Contact not found");
  return toDTO(row);
}

export async function deleteContact(
  session: FullSession,
  clientId: string,
  contactId: string,
): Promise<void> {
  await assertClientInOrg(session, clientId);
  const deleted = await contactsRepo.deleteByIdAndClientId(contactId, clientId);
  if (!deleted) throw new NotFoundError("Contact not found");
}
