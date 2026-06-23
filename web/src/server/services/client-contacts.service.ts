import "server-only";

import type { FullSession } from "@/server/auth/session";
import {
  requireCapability,
  requirePermission,
} from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import * as clientsRepo from "@/server/repositories/clients.repository";
import * as contactsRepo from "@/server/repositories/client-contacts.repository";
import type { Database } from "@/server/db/database.types";
import type { Client, ClientContact } from "@/server/db/domain.types";
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
// Authorization
// ============================================================
//
// Contacts have no org_id; authorization (and record scope) is INHERITED from
// the authoritative parent client. The trusted context is built ONLY from a
// server-loaded client — never from client-supplied ids/relationships. The
// org-scoped load below also enforces tenant isolation: a parent client in
// another org returns 404 (does not reveal existence), and the repo methods
// are scoped by (id, client_id) so a contact cannot be reached through the
// wrong parent.

async function loadClientInOrg(
  session: FullSession,
  clientId: string,
): Promise<Client> {
  const client = await clientsRepo.findByIdAndOrgId(
    clientId,
    session.organization.id,
  );
  if (!client) {
    // Don't reveal whether the client exists in some other org — same
    // pattern as the rest of the service.
    throw new NotFoundError("Client not found");
  }
  return client;
}

function clientContext(row: Client): { orgId: string; ownerId: string | null } {
  return { orgId: row.org_id, ownerId: row.created_by };
}

// ============================================================
// Public API (service is the authoritative authorization layer)
// ============================================================

export async function listContacts(
  session: FullSession,
  clientId: string,
): Promise<{ items: ContactDTO[] }> {
  const client = await loadClientInOrg(session, clientId);
  requirePermission(session, PERMISSIONS.CONTACTS_VIEW, {
    parentClient: clientContext(client),
  });
  const rows = await contactsRepo.findManyByClientId(clientId);
  return { items: rows.map(toDTO) };
}

export async function getContact(
  session: FullSession,
  clientId: string,
  contactId: string,
): Promise<ContactDTO> {
  const client = await loadClientInOrg(session, clientId);
  requirePermission(session, PERMISSIONS.CONTACTS_VIEW, {
    parentClient: clientContext(client),
  });
  const row = await contactsRepo.findByIdAndClientId(contactId, clientId);
  if (!row) throw new NotFoundError("Contact not found");
  return toDTO(row);
}

export async function createContact(
  session: FullSession,
  clientId: string,
  input: CreateContactPayload,
): Promise<ContactDTO> {
  const client = await loadClientInOrg(session, clientId);
  // contacts.create takes the parent CLIENT as its context (no contact yet).
  requirePermission(session, PERMISSIONS.CONTACTS_CREATE, clientContext(client));
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
  const client = await loadClientInOrg(session, clientId);
  requirePermission(session, PERMISSIONS.CONTACTS_EDIT, {
    parentClient: clientContext(client),
  });
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
  // Owner/Manager only (Phase 3 approved policy). Coarse gate first so an
  // Employee is rejected with a generic forbidden response without revealing
  // whether the client/contact exists. This remains a HARD delete (unchanged);
  // soft-delete/recovery/audit are a separate Decision Gate.
  requireCapability(session, PERMISSIONS.CONTACTS_DELETE);
  const client = await loadClientInOrg(session, clientId);
  requirePermission(session, PERMISSIONS.CONTACTS_DELETE, {
    parentClient: clientContext(client),
  });
  const deleted = await contactsRepo.deleteByIdAndClientId(contactId, clientId);
  if (!deleted) throw new NotFoundError("Contact not found");
}
