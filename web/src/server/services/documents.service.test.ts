import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { InvoiceDocument, Ledger, UserRole } from "@/server/db/domain.types";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";

vi.mock("@/server/repositories/documents.repository", () => ({
  findManyByOrgId: vi.fn(),
  findByIdAndOrgId: vi.fn(),
  findLines: vi.fn(),
  findPayments: vi.fn(),
  create: vi.fn(),
  updateByIdAndOrgId: vi.fn(),
  deleteByIdAndOrgId: vi.fn(),
  replaceLines: vi.fn(),
  replacePayments: vi.fn(),
  rpcIssueDocument: vi.fn(),
  rpcCancelDocument: vi.fn(),
  rpcCreateCreditNote: vi.fn(),
  findVatRates: vi.fn(),
}));
vi.mock("@/server/repositories/ledgers.repository", () => ({
  findManyByOrgId: vi.fn(),
  findSelfByOrgId: vi.fn(),
  findByIdAndOrgId: vi.fn(),
  updateByIdAndOrgId: vi.fn(),
}));
vi.mock("@/server/repositories/clients.repository", () => ({
  findByIdAndOrgId: vi.fn(),
}));

import * as documentsRepo from "@/server/repositories/documents.repository";
import * as ledgersRepo from "@/server/repositories/ledgers.repository";
import * as clientsRepo from "@/server/repositories/clients.repository";
import {
  cancelDocument,
  createCreditNote,
  createDraft,
  deleteDraft,
  getDocument,
  issueDocument,
  listDocuments,
  updateDraft,
} from "@/server/services/documents.service";

const ORG = "org-1";
const ME = "user-me";
const LEDGER = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";

function session(role: UserRole = "owner"): FullSession {
  return {
    user: { id: ME },
    profile: { id: ME, role, full_name: "אני", email: "me@x.test" },
    organization: { id: ORG, name: "משרד" },
    activeOrg: { id: ORG, name: "משרד" },
    activeRole: role,
  } as unknown as FullSession;
}

function docRow(o: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: DOC,
    org_id: ORG,
    ledger_id: LEDGER,
    doc_type: "305",
    status: "draft",
    number: null,
    doc_date: "2026-07-16",
    value_date: null,
    issued_at: null,
    issued_by: null,
    client_id: null,
    buyer_name: "לקוח בדיקה",
    buyer_tax_id: null,
    buyer_address: null,
    buyer_email: null,
    buyer_phone: null,
    seller_legal_name: null,
    seller_business_id: null,
    seller_address_street: null,
    seller_address_city: null,
    seller_address_zip: null,
    amount_before_discount: 0,
    discount_amount: 0,
    net_amount: 0,
    vat_rate_bp: null,
    vat_amount: 0,
    total_amount: 0,
    withholding_amount: 0,
    currency: "ILS",
    allocation_status: "not_required",
    allocation_number: null,
    allocation_requested_at: null,
    allocation_error: null,
    base_document_id: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
    delivered_at: null,
    pdf_path: null,
    pdf_sha256: null,
    signed_pdf_path: null,
    notes: null,
    created_by: ME,
    created_at: "2026-07-16T10:00:00.000Z",
    updated_at: "2026-07-16T10:00:00.000Z",
    ...o,
  } as InvoiceDocument;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentsRepo.findByIdAndOrgId).mockResolvedValue(docRow());
  vi.mocked(documentsRepo.findLines).mockResolvedValue([]);
  vi.mocked(documentsRepo.findPayments).mockResolvedValue([]);
  vi.mocked(documentsRepo.findManyByOrgId).mockResolvedValue([docRow()]);
  vi.mocked(documentsRepo.create).mockImplementation(
    async (i) => docRow(i as Partial<InvoiceDocument>),
  );
  vi.mocked(ledgersRepo.findByIdAndOrgId).mockResolvedValue({
    id: LEDGER,
    org_id: ORG,
  } as Ledger);
  vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue({
    id: CLIENT,
    org_id: ORG,
    name: "לקוח אמיתי",
  } as never);
  vi.mocked(documentsRepo.rpcIssueDocument).mockResolvedValue({
    number: 1,
    issued_at: "2026-07-16T11:00:00.000Z",
  });
  vi.mocked(documentsRepo.rpcCreateCreditNote).mockResolvedValue("new-330-id");
});

describe("createDraft", () => {
  it("creates a draft with numbered lines and buyer from the linked client", async () => {
    const dto = await createDraft(session("employee"), {
      ledgerId: LEDGER,
      docType: "305",
      clientId: CLIENT,
      buyerName: undefined,
      docDate: "2026-07-16",
      valueDate: undefined,
      notes: undefined,
      discount: 0,
      withholding: 0,
      lines: [
        { description: "שירות", quantity: 2, unitPrice: 10000, lineDiscount: 0 },
      ],
      payments: [],
    });
    expect(clientsRepo.findByIdAndOrgId).toHaveBeenCalledWith(CLIENT, ORG);
    expect(documentsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG,
        ledger_id: LEDGER,
        doc_type: "305",
        status: "draft",
        client_id: CLIENT,
        buyer_name: "לקוח אמיתי",
        created_by: ME,
      }),
    );
    expect(documentsRepo.replaceLines).toHaveBeenCalledWith(
      DOC,
      ORG,
      [
        expect.objectContaining({
          line_no: 1,
          description: "שירות",
          quantity: 2,
          unit_price: 10000,
          line_total: 20000,
        }),
      ],
    );
    expect(dto.id).toBe(DOC);
  });

  it("rejects a ledger that is not in the org", async () => {
    vi.mocked(ledgersRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(
      createDraft(session(), {
        ledgerId: LEDGER,
        docType: "305",
        clientId: null,
        buyerName: "מישהו",
        docDate: "2026-07-16",
        valueDate: undefined,
        notes: undefined,
        discount: 0,
        withholding: 0,
        lines: [],
        payments: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(documentsRepo.create).not.toHaveBeenCalled();
  });

  it("rejects a client from another org (repo returns null)", async () => {
    vi.mocked(clientsRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(
      createDraft(session(), {
        ledgerId: LEDGER,
        docType: "305",
        clientId: CLIENT,
        buyerName: undefined,
        docDate: "2026-07-16",
        valueDate: undefined,
        notes: undefined,
        discount: 0,
        withholding: 0,
        lines: [],
        payments: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(documentsRepo.create).not.toHaveBeenCalled();
  });
});

describe("updateDraft / deleteDraft", () => {
  it("rejects editing an issued document", async () => {
    vi.mocked(documentsRepo.findByIdAndOrgId).mockResolvedValue(
      docRow({ status: "issued", number: 7 }),
    );
    await expect(
      updateDraft(session(), DOC, { notes: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(documentsRepo.updateByIdAndOrgId).not.toHaveBeenCalled();
  });

  it("replaces lines on update when provided", async () => {
    vi.mocked(documentsRepo.updateByIdAndOrgId).mockResolvedValue(docRow());
    await updateDraft(session(), DOC, {
      notes: "עודכן",
      lines: [
        { description: "חדש", quantity: 1, unitPrice: 5000, lineDiscount: 0 },
      ],
    });
    expect(documentsRepo.replaceLines).toHaveBeenCalledWith(DOC, ORG, [
      expect.objectContaining({ line_no: 1, unit_price: 5000, line_total: 5000 }),
    ]);
  });

  it("deletes only drafts", async () => {
    vi.mocked(documentsRepo.findByIdAndOrgId).mockResolvedValue(
      docRow({ status: "cancelled", number: 3 }),
    );
    await expect(deleteDraft(session(), DOC)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(documentsRepo.deleteByIdAndOrgId).not.toHaveBeenCalled();
  });
});

describe("legal transitions — capability gating", () => {
  it("owner issues (RPC called, result mapped)", async () => {
    const res = await issueDocument(session("owner"), DOC);
    expect(documentsRepo.rpcIssueDocument).toHaveBeenCalledWith(DOC);
    expect(res).toEqual({ number: 1, issuedAt: "2026-07-16T11:00:00.000Z" });
  });

  it("manager (admin) issues too", async () => {
    await issueDocument(session("admin"), DOC);
    expect(documentsRepo.rpcIssueDocument).toHaveBeenCalledWith(DOC);
  });

  it("EMPLOYEE is denied issue/cancel/credit — RPC never reached", async () => {
    await expect(issueDocument(session("employee"), DOC)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      cancelDocument(session("employee"), DOC, "טעות"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createCreditNote(session("employee"), DOC),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(documentsRepo.rpcIssueDocument).not.toHaveBeenCalled();
    expect(documentsRepo.rpcCancelDocument).not.toHaveBeenCalled();
    expect(documentsRepo.rpcCreateCreditNote).not.toHaveBeenCalled();
  });

  it("404s a cross-org document BEFORE hitting the RPC", async () => {
    vi.mocked(documentsRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(issueDocument(session("owner"), DOC)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(documentsRepo.rpcIssueDocument).not.toHaveBeenCalled();
  });

  it("translates an RPC business-rule rejection into a 400 ValidationError", async () => {
    vi.mocked(documentsRepo.rpcIssueDocument).mockRejectedValue(
      Object.assign(new Error("ledger is missing business_id"), {
        code: "P0001",
      }),
    );
    await expect(issueDocument(session("owner"), DOC)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("credit returns the new draft id", async () => {
    vi.mocked(documentsRepo.findByIdAndOrgId).mockResolvedValue(
      docRow({ status: "issued", number: 5 }),
    );
    const res = await createCreditNote(session("admin"), DOC);
    expect(res).toEqual({ id: "new-330-id" });
  });
});

describe("reads", () => {
  it("lists with filter passthrough", async () => {
    await listDocuments(session("employee"), {
      docType: "305",
      status: "issued",
      search: undefined,
      limit: 50,
      offset: 0,
    });
    expect(documentsRepo.findManyByOrgId).toHaveBeenCalledWith(ORG, {
      docType: "305",
      status: "issued",
      search: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it("getDocument maps the full DTO with lines and payments", async () => {
    vi.mocked(documentsRepo.findLines).mockResolvedValue([
      {
        id: "l1",
        org_id: ORG,
        document_id: DOC,
        line_no: 1,
        description: "שירות",
        catalog_id: null,
        unit: null,
        quantity: 2,
        unit_price: 10000,
        line_discount: 0,
        line_total: 20000,
        created_at: "",
        updated_at: "",
      } as never,
    ]);
    const dto = await getDocument(session("employee"), DOC);
    expect(dto.lines).toHaveLength(1);
    expect(dto.lines[0].lineTotal).toBe(20000);
    expect("org_id" in dto).toBe(false);
  });

  it("404s an unknown document", async () => {
    vi.mocked(documentsRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(getDocument(session(), DOC)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
