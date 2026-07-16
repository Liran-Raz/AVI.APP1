import "server-only";

import type { FullSession } from "@/server/auth/session";
import { requireCapability } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import { NotFoundError, ValidationError } from "@/server/errors/app-error";
import type { Ledger } from "@/server/db/domain.types";
import type { Database } from "@/server/db/database.types";
import * as ledgersRepo from "@/server/repositories/ledgers.repository";
import type { UpdateLedgerPayload } from "@/server/validators/ledgers.schema";

// Ledgers service (DEV-026 R1) — business logic + permission gating + DTO
// mapping for בתי-עסק. The ledger carries the legal/tax identity that prints
// on tax documents; Stage A exposes only the org's SELF-ledger (the office
// itself), seeded by migration 0027 and by the organizations insert-trigger.
//
// Gating (see permission-grants.ts):
//   ledgers.view   — every role (the wizard/header shows the business identity)
//   ledgers.manage — OWNER ONLY (legal identity, numbering, credentials)

type LedgerUpdate = Database["public"]["Tables"]["ledgers"]["Update"];

export type LedgerDTO = {
  id: string;
  isSelf: boolean;
  legalName: string;
  tradeName: string | null;
  businessId: string | null;
  businessType: Ledger["business_type"];
  addressStreet: string | null;
  addressCity: string | null;
  addressZip: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  currency: string;
  /** True when the ledger can legally issue documents (identity complete). */
  issueReady: boolean;
  createdAt: string;
  updatedAt: string;
};

function toDTO(row: Ledger): LedgerDTO {
  return {
    id: row.id,
    isSelf: row.is_self,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    businessId: row.business_id,
    businessType: row.business_type,
    addressStreet: row.address_street,
    addressCity: row.address_city,
    addressZip: row.address_zip,
    phone: row.phone,
    email: row.email,
    logoUrl: row.logo_url,
    currency: row.currency,
    issueReady: row.business_id !== null && row.legal_name.trim().length > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Reads
// ============================================================

export async function listLedgers(session: FullSession): Promise<LedgerDTO[]> {
  requireCapability(session, PERMISSIONS.LEDGERS_VIEW);
  const rows = await ledgersRepo.findManyByOrgId(session.organization.id);
  return rows.map(toDTO);
}

export async function getSelfLedger(session: FullSession): Promise<LedgerDTO> {
  requireCapability(session, PERMISSIONS.LEDGERS_VIEW);
  const row = await ledgersRepo.findSelfByOrgId(session.organization.id);
  if (!row) {
    // 0027 backfills every org and an insert-trigger covers new orgs, so this
    // indicates the migration was not applied — surface loudly.
    throw new NotFoundError(
      "Self ledger not found — has migration 0027 been applied?",
    );
  }
  return toDTO(row);
}

// ============================================================
// Update (business profile)
// ============================================================

export async function updateLedger(
  session: FullSession,
  ledgerId: string,
  payload: UpdateLedgerPayload,
): Promise<LedgerDTO> {
  requireCapability(session, PERMISSIONS.LEDGERS_MANAGE);

  const existing = await ledgersRepo.findByIdAndOrgId(
    ledgerId,
    session.organization.id,
  );
  if (!existing) throw new NotFoundError("Ledger not found");

  const patch: LedgerUpdate = {};
  if (payload.legalName !== undefined) patch.legal_name = payload.legalName;
  if (payload.tradeName !== undefined) patch.trade_name = payload.tradeName;
  if (payload.businessId !== undefined) patch.business_id = payload.businessId;
  if (payload.businessType !== undefined) patch.business_type = payload.businessType;
  if (payload.addressStreet !== undefined) patch.address_street = payload.addressStreet;
  if (payload.addressCity !== undefined) patch.address_city = payload.addressCity;
  if (payload.addressZip !== undefined) patch.address_zip = payload.addressZip;
  if (payload.phone !== undefined) patch.phone = payload.phone;
  if (payload.email !== undefined) patch.email = payload.email;

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("No fields to update");
  }

  const updated = await ledgersRepo.updateByIdAndOrgId(
    ledgerId,
    session.organization.id,
    patch,
  );
  if (!updated) throw new NotFoundError("Ledger not found");
  return toDTO(updated);
}
