import "server-only";

import type { FullSession } from "@/server/auth/session";
import { requireCapability } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import {
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";
import type {
  DocumentLine,
  DocumentPayment,
  InvoiceDocument,
} from "@/server/db/domain.types";
import * as documentsRepo from "@/server/repositories/documents.repository";
import * as ledgersRepo from "@/server/repositories/ledgers.repository";
import * as clientsRepo from "@/server/repositories/clients.repository";
import type {
  CreateDocumentPayload,
  ListDocumentsQuery,
  UpdateDocumentPayload,
} from "@/server/validators/documents.schema";

// Documents service (DEV-026 R2) — business logic + capability gating + DTO
// mapping for tax documents. Drafts are app-managed; the LEGAL transitions
// (issue/cancel/credit) call the 0027 SECURITY DEFINER RPCs, which re-validate
// membership + role + state in the DB (belt), while this layer enforces the
// fine-grained capability keys (suspenders):
//   invoices.view/create — every role (create = drafts only)
//   invoices.issue/cancel/credit — Owner + Manager (employee denied)

export type DocumentLineDTO = {
  id: string;
  lineNo: number;
  description: string;
  catalogId: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  lineTotal: number;
};

export type DocumentPaymentDTO = {
  id: string;
  lineNo: number;
  method: number;
  amount: number;
  dueDate: string | null;
  bankNo: string | null;
  branchNo: string | null;
  accountNo: string | null;
  chequeNo: string | null;
  cardCompany: number | null;
  cardTxType: number | null;
  reference: string | null;
};

export type DocumentSummaryDTO = {
  id: string;
  docType: InvoiceDocument["doc_type"];
  status: InvoiceDocument["status"];
  number: number | null;
  docDate: string;
  buyerName: string | null;
  totalAmount: number;
  currency: string;
  allocationStatus: InvoiceDocument["allocation_status"];
  createdAt: string;
};

export type DocumentDTO = DocumentSummaryDTO & {
  ledgerId: string;
  clientId: string | null;
  buyerTaxId: string | null;
  buyerAddress: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  sellerLegalName: string | null;
  sellerBusinessId: string | null;
  valueDate: string | null;
  issuedAt: string | null;
  amountBeforeDiscount: number;
  discountAmount: number;
  netAmount: number;
  vatRateBp: number | null;
  vatAmount: number;
  withholdingAmount: number;
  allocationNumber: string | null;
  baseDocumentId: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  deliveredAt: string | null;
  notes: string | null;
  lines: DocumentLineDTO[];
  payments: DocumentPaymentDTO[];
};

function toSummaryDTO(row: InvoiceDocument): DocumentSummaryDTO {
  return {
    id: row.id,
    docType: row.doc_type,
    status: row.status,
    number: row.number,
    docDate: row.doc_date,
    buyerName: row.buyer_name,
    totalAmount: row.total_amount,
    currency: row.currency,
    allocationStatus: row.allocation_status,
    createdAt: row.created_at,
  };
}

function toLineDTO(row: DocumentLine): DocumentLineDTO {
  return {
    id: row.id,
    lineNo: row.line_no,
    description: row.description,
    catalogId: row.catalog_id,
    unit: row.unit,
    quantity: Number(row.quantity),
    unitPrice: row.unit_price,
    lineDiscount: row.line_discount,
    lineTotal: row.line_total,
  };
}

function toPaymentDTO(row: DocumentPayment): DocumentPaymentDTO {
  return {
    id: row.id,
    lineNo: row.line_no,
    method: row.method,
    amount: row.amount,
    dueDate: row.due_date,
    bankNo: row.bank_no,
    branchNo: row.branch_no,
    accountNo: row.account_no,
    chequeNo: row.cheque_no,
    cardCompany: row.card_company,
    cardTxType: row.card_tx_type,
    reference: row.reference,
  };
}

function toFullDTO(
  row: InvoiceDocument,
  lines: DocumentLine[],
  payments: DocumentPayment[],
): DocumentDTO {
  return {
    ...toSummaryDTO(row),
    ledgerId: row.ledger_id,
    clientId: row.client_id,
    buyerTaxId: row.buyer_tax_id,
    buyerAddress: row.buyer_address,
    buyerEmail: row.buyer_email,
    buyerPhone: row.buyer_phone,
    sellerLegalName: row.seller_legal_name,
    sellerBusinessId: row.seller_business_id,
    valueDate: row.value_date,
    issuedAt: row.issued_at,
    amountBeforeDiscount: row.amount_before_discount,
    discountAmount: row.discount_amount,
    netAmount: row.net_amount,
    vatRateBp: row.vat_rate_bp,
    vatAmount: row.vat_amount,
    withholdingAmount: row.withholding_amount,
    allocationNumber: row.allocation_number,
    baseDocumentId: row.base_document_id,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    deliveredAt: row.delivered_at,
    notes: row.notes,
    lines: lines.map(toLineDTO),
    payments: payments.map(toPaymentDTO),
  };
}

// Translate an RPC business-rule rejection (Postgres RAISE) into a 400 the
// client can show, instead of leaking a raw 500.
function rethrowRpcError(err: unknown): never {
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : "Operation failed";
  throw new ValidationError(message);
}

// ============================================================
// Reads
// ============================================================

export async function listDocuments(
  session: FullSession,
  query: ListDocumentsQuery,
): Promise<{ items: DocumentSummaryDTO[] }> {
  requireCapability(session, PERMISSIONS.INVOICES_VIEW);
  const rows = await documentsRepo.findManyByOrgId(session.organization.id, {
    docType: query.docType,
    status: query.status,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toSummaryDTO) };
}

export async function getDocument(
  session: FullSession,
  id: string,
): Promise<DocumentDTO> {
  requireCapability(session, PERMISSIONS.INVOICES_VIEW);
  const orgId = session.organization.id;
  const row = await documentsRepo.findByIdAndOrgId(id, orgId);
  if (!row) throw new NotFoundError("Document not found");
  const [lines, payments] = await Promise.all([
    documentsRepo.findLines(id, orgId),
    documentsRepo.findPayments(id, orgId),
  ]);
  return toFullDTO(row, lines, payments);
}

// ============================================================
// Draft lifecycle
// ============================================================

async function resolveBuyer(
  session: FullSession,
  clientId: string | null | undefined,
  buyerName: string | null | undefined,
): Promise<{ client_id: string | null; buyer_name: string | null }> {
  if (clientId) {
    const client = await clientsRepo.findByIdAndOrgId(
      clientId,
      session.organization.id,
    );
    if (!client) throw new ValidationError("Client not found in this office");
    return { client_id: client.id, buyer_name: client.name };
  }
  return { client_id: null, buyer_name: buyerName ?? null };
}

function linesToInserts(
  orgId: string,
  documentId: string,
  lines: CreateDocumentPayload["lines"],
) {
  return lines.map((l, i) => ({
    org_id: orgId,
    document_id: documentId,
    line_no: i + 1,
    description: l.description,
    catalog_id: l.catalogId ?? null,
    unit: l.unit ?? null,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    line_discount: l.lineDiscount ?? 0,
    // Preview value — the issue RPC recomputes authoritatively.
    line_total: Math.round(l.quantity * l.unitPrice) - (l.lineDiscount ?? 0),
  }));
}

function paymentsToInserts(
  orgId: string,
  documentId: string,
  payments: CreateDocumentPayload["payments"],
) {
  return payments.map((p, i) => ({
    org_id: orgId,
    document_id: documentId,
    line_no: i + 1,
    method: p.method,
    amount: p.amount,
    due_date: p.dueDate ?? null,
    bank_no: p.bankNo ?? null,
    branch_no: p.branchNo ?? null,
    account_no: p.accountNo ?? null,
    cheque_no: p.chequeNo ?? null,
    card_company: p.cardCompany ?? null,
    card_tx_type: p.cardTxType ?? null,
    reference: p.reference ?? null,
  }));
}

export async function createDraft(
  session: FullSession,
  payload: CreateDocumentPayload,
): Promise<DocumentDTO> {
  requireCapability(session, PERMISSIONS.INVOICES_CREATE);
  const orgId = session.organization.id;

  const ledger = await ledgersRepo.findByIdAndOrgId(payload.ledgerId, orgId);
  if (!ledger) throw new ValidationError("Ledger not found in this office");

  const buyer = await resolveBuyer(session, payload.clientId, payload.buyerName);

  const created = await documentsRepo.create({
    org_id: orgId,
    ledger_id: ledger.id,
    doc_type: payload.docType,
    status: "draft",
    doc_date: payload.docDate,
    value_date: payload.valueDate ?? null,
    notes: payload.notes ?? null,
    discount_amount: payload.discount ?? 0,
    withholding_amount: payload.withholding ?? 0,
    client_id: buyer.client_id,
    buyer_name: buyer.buyer_name,
    created_by: session.user.id,
  });

  if (payload.lines.length > 0) {
    await documentsRepo.replaceLines(
      created.id,
      orgId,
      linesToInserts(orgId, created.id, payload.lines),
    );
  }
  if (payload.payments.length > 0) {
    await documentsRepo.replacePayments(
      created.id,
      orgId,
      paymentsToInserts(orgId, created.id, payload.payments),
    );
  }

  return getDocument(session, created.id);
}

export async function updateDraft(
  session: FullSession,
  id: string,
  payload: UpdateDocumentPayload,
): Promise<DocumentDTO> {
  requireCapability(session, PERMISSIONS.INVOICES_CREATE);
  const orgId = session.organization.id;

  const existing = await documentsRepo.findByIdAndOrgId(id, orgId);
  if (!existing) throw new NotFoundError("Document not found");
  if (existing.status !== "draft") {
    throw new ValidationError(
      "Issued documents are immutable — cancel or credit instead",
    );
  }

  const patch: Record<string, unknown> = {};
  if (payload.docDate !== undefined) patch.doc_date = payload.docDate;
  if (payload.valueDate !== undefined) patch.value_date = payload.valueDate;
  if (payload.notes !== undefined) patch.notes = payload.notes;
  if (payload.discount !== undefined) patch.discount_amount = payload.discount;
  if (payload.withholding !== undefined)
    patch.withholding_amount = payload.withholding;

  if (payload.clientId !== undefined || payload.buyerName !== undefined) {
    const buyer = await resolveBuyer(
      session,
      payload.clientId ?? existing.client_id,
      payload.buyerName ?? existing.buyer_name,
    );
    patch.client_id = buyer.client_id;
    patch.buyer_name = buyer.buyer_name;
  }

  if (Object.keys(patch).length > 0) {
    const updated = await documentsRepo.updateByIdAndOrgId(id, orgId, patch);
    if (!updated) throw new NotFoundError("Document not found");
  }

  if (payload.lines !== undefined) {
    await documentsRepo.replaceLines(
      id,
      orgId,
      linesToInserts(orgId, id, payload.lines),
    );
  }
  if (payload.payments !== undefined) {
    await documentsRepo.replacePayments(
      id,
      orgId,
      paymentsToInserts(orgId, id, payload.payments),
    );
  }

  return getDocument(session, id);
}

export async function deleteDraft(
  session: FullSession,
  id: string,
): Promise<void> {
  requireCapability(session, PERMISSIONS.INVOICES_CREATE);
  const orgId = session.organization.id;
  const existing = await documentsRepo.findByIdAndOrgId(id, orgId);
  if (!existing) throw new NotFoundError("Document not found");
  if (existing.status !== "draft") {
    throw new ValidationError("Only drafts can be deleted");
  }
  await documentsRepo.deleteByIdAndOrgId(id, orgId);
}

// ============================================================
// Legal transitions (RPCs; DB re-validates membership+role+state)
// ============================================================

export async function issueDocument(
  session: FullSession,
  id: string,
): Promise<{ number: number; issuedAt: string }> {
  requireCapability(session, PERMISSIONS.INVOICES_ISSUE);
  // Existence/org check first — a cross-org id must 404, not hit the RPC.
  const existing = await documentsRepo.findByIdAndOrgId(
    id,
    session.organization.id,
  );
  if (!existing) throw new NotFoundError("Document not found");
  try {
    const res = await documentsRepo.rpcIssueDocument(id);
    return { number: res.number, issuedAt: res.issued_at };
  } catch (err) {
    rethrowRpcError(err);
  }
}

export async function cancelDocument(
  session: FullSession,
  id: string,
  reason: string,
): Promise<void> {
  requireCapability(session, PERMISSIONS.INVOICES_CANCEL);
  const existing = await documentsRepo.findByIdAndOrgId(
    id,
    session.organization.id,
  );
  if (!existing) throw new NotFoundError("Document not found");
  try {
    await documentsRepo.rpcCancelDocument(id, reason);
  } catch (err) {
    rethrowRpcError(err);
  }
}

export async function createCreditNote(
  session: FullSession,
  id: string,
): Promise<{ id: string }> {
  requireCapability(session, PERMISSIONS.INVOICES_CREDIT);
  const existing = await documentsRepo.findByIdAndOrgId(
    id,
    session.organization.id,
  );
  if (!existing) throw new NotFoundError("Document not found");
  try {
    const newId = await documentsRepo.rpcCreateCreditNote(id);
    return { id: newId };
  } catch (err) {
    rethrowRpcError(err);
  }
}

// ============================================================
// VAT rates (wizard preview; the issue RPC is authoritative)
// ============================================================

export type VatRateDTO = {
  rateBp: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export async function listVatRates(
  session: FullSession,
): Promise<VatRateDTO[]> {
  requireCapability(session, PERMISSIONS.INVOICES_VIEW);
  const rows = await documentsRepo.findVatRates();
  return rows.map((r) => ({
    rateBp: r.rate_bp,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  }));
}
