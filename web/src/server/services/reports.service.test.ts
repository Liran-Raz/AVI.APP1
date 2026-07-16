import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { InvoiceDocument, UserRole } from "@/server/db/domain.types";
import { ForbiddenError, ValidationError } from "@/server/errors/app-error";
import type { DocumentWithChildren } from "@/server/repositories/reports.repository";

vi.mock("@/server/repositories/reports.repository", () => ({
  MAX_REPORT_DOCUMENTS: 20_000,
  findDocumentsInRange: vi.fn(),
  findDocumentsWithChildrenInRange: vi.fn(),
  findDocumentsByIds: vi.fn(),
}));
vi.mock("@/server/repositories/ledgers.repository", () => ({
  findSelfByOrgId: vi.fn(),
}));

import * as reportsRepo from "@/server/repositories/reports.repository";
import * as ledgersRepo from "@/server/repositories/ledgers.repository";
import {
  aggregateClientBalances,
  aggregateDocTypeSummary,
  aggregateVatSummary,
  buildReceiptsBook,
  buildSalesBook,
  buyerKeyFor,
  exportOpenFormatZip,
  getDocTypeSummary,
  getOpenFormatSummary,
  getReportCsv,
  normalizeVatId,
  toCsv,
} from "@/server/services/reports.service";

const ORG = "org-1";

function session(role: UserRole = "owner"): FullSession {
  return {
    user: { id: "user-me" },
    profile: { id: "user-me", role, full_name: "אני", email: "me@x.test" },
    organization: { id: ORG, name: "משרד" },
    activeOrg: { id: ORG, name: "משרד" },
    activeRole: role,
  } as unknown as FullSession;
}

let seq = 0;
function docRow(o: Partial<InvoiceDocument> = {}): InvoiceDocument {
  seq += 1;
  return {
    id: `doc-${seq}`,
    org_id: ORG,
    ledger_id: "ledger-1",
    doc_type: "305",
    status: "issued",
    number: seq,
    doc_date: "2026-03-10",
    value_date: null,
    issued_at: "2026-03-10T08:00:00+00:00",
    issued_by: null,
    client_id: null,
    buyer_name: "לקוח א",
    buyer_tax_id: null,
    buyer_address: null,
    buyer_email: null,
    buyer_phone: null,
    seller_legal_name: "משרד",
    seller_business_id: "002233445",
    seller_address_street: null,
    seller_address_city: null,
    seller_address_zip: null,
    amount_before_discount: 100000,
    discount_amount: 0,
    net_amount: 100000,
    vat_rate_bp: 1800,
    vat_amount: 18000,
    total_amount: 118000,
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
    created_by: null,
    created_at: "2026-03-10T08:00:00+00:00",
    updated_at: "2026-03-10T08:00:00+00:00",
    ...o,
  } as InvoiceDocument;
}

function withChildren(
  doc: InvoiceDocument,
  lines: DocumentWithChildren["document_lines"] = [],
  payments: DocumentWithChildren["document_payments"] = [],
): DocumentWithChildren {
  return { ...doc, document_lines: lines, document_payments: payments };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Pure aggregations
// ============================================================

describe("aggregateDocTypeSummary", () => {
  it("lists every נספח-1 type, zeros for unmanaged, cancelled split out", () => {
    const rows = aggregateDocTypeSummary([
      docRow({ doc_type: "305", total_amount: 118000 }),
      docRow({ doc_type: "305", total_amount: 59000, status: "cancelled" }),
      docRow({ doc_type: "400", total_amount: 50000 }),
    ]);
    expect(rows).toHaveLength(27); // the full official table
    const t305 = rows.find((r) => r.docType === "305")!;
    expect(t305).toMatchObject({
      managed: true,
      count: 2,
      cancelledCount: 1,
      totalAgorot: 118000, // cancelled docs stay in the count, not the sum
    });
    const t100 = rows.find((r) => r.docType === "100")!;
    expect(t100).toMatchObject({ managed: false, count: 0, totalAgorot: 0 });
  });
});

describe("buildSalesBook", () => {
  it("orders chronologically, negates credit notes in the totals only", () => {
    const book = buildSalesBook([
      docRow({ doc_type: "305", number: 2, doc_date: "2026-03-20" }),
      docRow({ doc_type: "305", number: 1, doc_date: "2026-03-01" }),
      docRow({
        doc_type: "330",
        number: 1,
        doc_date: "2026-03-25",
        net_amount: 50000,
        vat_amount: 9000,
        total_amount: 59000,
      }),
      docRow({ doc_type: "400", number: 9 }), // receipts are NOT sales rows
      docRow({
        doc_type: "305",
        number: 3,
        doc_date: "2026-03-30",
        status: "cancelled",
      }),
    ]);
    expect(book.rows.map((r) => `${r.docType}/${r.number}`)).toEqual([
      "305/1",
      "305/2",
      "330/1",
      "305/3",
    ]);
    expect(book.rows[2].signedTotalAgorot).toBe(-59000);
    // Totals: two issued 305s minus the credit; the cancelled one excluded.
    expect(book.totals).toEqual({
      documentCount: 3,
      netAgorot: 100000 + 100000 - 50000,
      vatAgorot: 18000 + 18000 - 9000,
      totalAgorot: 118000 + 118000 - 59000,
    });
  });
});

describe("buildReceiptsBook", () => {
  it("flattens payment lines of 400/320 and sums by method", () => {
    const receipt = withChildren(
      docRow({ doc_type: "400", number: 10, withholding_amount: 5000 }),
      [],
      [
        {
          id: "p1", org_id: ORG, document_id: "d", line_no: 1, method: 2,
          amount: 60000, due_date: "2026-04-01", bank_no: "12", branch_no: "600",
          account_no: "123", cheque_no: "77", card_company: null, card_tx_type: null,
          reference: null, created_at: "", updated_at: "",
        },
        {
          id: "p2", org_id: ORG, document_id: "d", line_no: 2, method: 1,
          amount: 40000, due_date: null, bank_no: null, branch_no: null,
          account_no: null, cheque_no: null, card_company: null, card_tx_type: null,
          reference: null, created_at: "", updated_at: "",
        },
      ],
    );
    const invoice = withChildren(docRow({ doc_type: "305", number: 11 }));
    const book = buildReceiptsBook([receipt, invoice]);
    expect(book.rows).toHaveLength(2);
    expect(book.rows[0].methodLabel).toBe("המחאה");
    expect(book.totalAgorot).toBe(100000);
    expect(book.withholdingAgorot).toBe(5000);
    expect(book.totalsByMethod).toEqual([
      { method: 1, methodLabel: "מזומן", amountAgorot: 40000 },
      { method: 2, methodLabel: "המחאה", amountAgorot: 60000 },
    ]);
  });
});

describe("aggregateVatSummary", () => {
  it("groups by month and nets credits against sales", () => {
    const vat = aggregateVatSummary([
      docRow({ doc_type: "305", doc_date: "2026-01-15" }),
      docRow({ doc_type: "320", doc_date: "2026-01-20" }),
      docRow({
        doc_type: "330",
        doc_date: "2026-02-05",
        net_amount: 50000,
        vat_amount: 9000,
      }),
      docRow({ doc_type: "400", doc_date: "2026-01-25" }), // receipts excluded
      docRow({ doc_type: "305", doc_date: "2026-01-30", status: "cancelled" }),
    ]);
    expect(vat.rows.map((r) => r.month)).toEqual(["2026-01", "2026-02"]);
    expect(vat.rows[0]).toMatchObject({
      salesNetAgorot: 200000,
      salesVatAgorot: 36000,
      creditNetAgorot: 0,
      netAgorot: 200000,
    });
    expect(vat.rows[1]).toMatchObject({
      creditNetAgorot: 50000,
      creditVatAgorot: 9000,
      netAgorot: -50000,
      vatAgorot: -9000,
    });
    expect(vat.totals.netAgorot).toBe(150000);
    expect(vat.totals.vatAgorot).toBe(27000);
  });
});

describe("aggregateClientBalances", () => {
  it("charges 305/320 minus 330, credits 400/320 plus withholding", () => {
    const rows = aggregateClientBalances([
      docRow({ client_id: "c1", buyer_name: "לקוח א", doc_type: "305" }), // +118000
      docRow({
        client_id: "c1",
        buyer_name: "לקוח א",
        doc_type: "400",
        total_amount: 100000,
        withholding_amount: 18000,
      }), // received 118000 incl withholding
      docRow({ client_id: null, buyer_name: "אורח", doc_type: "305" }),
    ]);
    const c1 = rows.find((r) => r.clientKey === "c1")!;
    expect(c1).toMatchObject({
      chargedAgorot: 118000,
      receivedAgorot: 118000,
      withholdingAgorot: 18000,
      balanceAgorot: 0,
    });
    const guest = rows.find((r) => r.clientKey === "name:אורח")!;
    expect(guest.balanceAgorot).toBe(118000);
  });

  it("a 320 charges and credits itself so it never distorts the balance", () => {
    const rows = aggregateClientBalances([
      docRow({ client_id: "c9", doc_type: "320", total_amount: 118000 }),
    ]);
    expect(rows[0].balanceAgorot).toBe(0);
  });
});

describe("helpers", () => {
  it("normalizeVatId pads to 9 digits and rejects garbage", () => {
    expect(normalizeVatId("2233445-6")).toBe("022334456");
    expect(normalizeVatId("512345678")).toBe("512345678");
    expect(() => normalizeVatId("no digits")).toThrow(ValidationError);
    expect(() => normalizeVatId("1234567890")).toThrow(ValidationError);
  });

  it("buyerKeyFor prefers tax id, then client id, then name", () => {
    expect(
      buyerKeyFor({ client_id: "c", buyer_tax_id: "51-234567.8", buyer_name: "x" }),
    ).toBe("512345678");
    expect(
      buyerKeyFor({
        client_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        buyer_tax_id: null,
        buyer_name: "x",
      }),
    ).toBe("Caaaaaaaabbbb");
    expect(
      buyerKeyFor({ client_id: null, buyer_tax_id: null, buyer_name: "לקוח מזדמן" }),
    ).toBe("לקוח מזדמן");
  });

  it("toCsv quotes cells, escapes quotes and starts with a BOM", () => {
    const csv = toCsv(["א", 'עם "מרכאות"'], [["1", 2]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"עם ""מרכאות"""');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

// ============================================================
// Session-facing gates + export orchestration
// ============================================================

describe("permission gates", () => {
  it("denies reports to employees (no reports.view grant)", async () => {
    await expect(
      getDocTypeSummary(session("employee"), { from: "2026-01-01", to: "2026-12-31" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("denies CSV to employees and allows managers", async () => {
    vi.mocked(reportsRepo.findDocumentsInRange).mockResolvedValue({
      rows: [],
      truncated: false,
    });
    await expect(
      getReportCsv(session("employee"), "sales", { from: "2026-01-01", to: "2026-12-31" }),
    ).rejects.toThrow(ForbiddenError);
    const csv = await getReportCsv(session("admin"), "sales", {
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(csv.fileName).toBe("sales-book_2026-01-01_2026-12-31.csv");
  });

  it("keeps the מבנה-אחיד export owner-only (invoices.export)", async () => {
    await expect(
      getOpenFormatSummary(session("admin"), { from: "2026-01-01", to: "2026-12-31" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("openformat export orchestration", () => {
  const RANGE = { from: "2026-01-01", to: "2026-12-31" };

  function selfLedger(businessId: string | null) {
    return {
      id: "ledger-1",
      org_id: ORG,
      is_self: true,
      legal_name: "משרד רואי חשבון",
      business_id: businessId,
      business_type: "murshe",
      address_street: "הרצל 1",
      address_city: "תל אביב",
      address_zip: null,
    } as unknown as Awaited<ReturnType<typeof ledgersRepo.findSelfByOrgId>>;
  }

  it("refuses to export before the business id is set", async () => {
    vi.mocked(ledgersRepo.findSelfByOrgId).mockResolvedValue(selfLedger(null));
    await expect(getOpenFormatSummary(session("owner"), RANGE)).rejects.toThrow(
      ValidationError,
    );
  });

  it("builds the zip and resolves base documents outside the range", async () => {
    vi.mocked(ledgersRepo.findSelfByOrgId).mockResolvedValue(
      selfLedger("022334456"),
    );
    const credit = withChildren(
      docRow({
        doc_type: "330",
        number: 3,
        base_document_id: "base-1",
        issued_at: "2026-06-20T10:00:00+00:00",
      }),
      [
        {
          id: "l1", org_id: ORG, document_id: "d", line_no: 1,
          description: "זיכוי", catalog_id: null, unit: null, quantity: 1,
          unit_price: 100000, line_discount: 0, line_total: 100000,
          created_at: "", updated_at: "",
        },
      ],
    );
    vi.mocked(reportsRepo.findDocumentsWithChildrenInRange).mockResolvedValue({
      rows: [credit],
      truncated: false,
    });
    vi.mocked(reportsRepo.findDocumentsByIds).mockResolvedValue([
      { id: "base-1", doc_type: "305", number: 2001 },
    ]);

    const summary = await getOpenFormatSummary(session("owner"), RANGE);
    expect(reportsRepo.findDocumentsByIds).toHaveBeenCalledWith(ORG, ["base-1"]);
    expect(summary.business.vatId).toBe("022334456");
    expect(summary.counts).toMatchObject({ C100: 1, D110: 1, D120: 0, total: 4 });
    expect(summary.savedPath).toMatch(/^\\OPENFRMT\\02233445\.\d{2}\\\d{8}$/);
    expect(summary.fileName).toBe("openformat_022334456_2026-01-01_2026-12-31.zip");

    const { buffer, fileName } = await exportOpenFormatZip(session("owner"), RANGE);
    expect(fileName).toBe(summary.fileName);
    expect(buffer.length).toBeGreaterThan(200);
    // ZIP magic bytes.
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("fails loudly when the range was truncated", async () => {
    vi.mocked(ledgersRepo.findSelfByOrgId).mockResolvedValue(
      selfLedger("022334456"),
    );
    vi.mocked(reportsRepo.findDocumentsWithChildrenInRange).mockResolvedValue({
      rows: [],
      truncated: true,
    });
    await expect(getOpenFormatSummary(session("owner"), RANGE)).rejects.toThrow(
      ValidationError,
    );
  });
});
