import "server-only";

import { randomInt } from "node:crypto";

import type { FullSession } from "@/server/auth/session";
import { requireCapability } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import { ValidationError } from "@/server/errors/app-error";
import type { InvoiceDocument } from "@/server/db/domain.types";
import * as reportsRepo from "@/server/repositories/reports.repository";
import * as ledgersRepo from "@/server/repositories/ledgers.repository";
import type { ReportRangeQuery } from "@/server/validators/reports.schema";
import { buildOpenFormat, zipOpenFormat } from "@/server/openformat/build";
import type {
  OpenFormatDocument,
  OpenFormatInput,
} from "@/server/openformat/records";

// Reports service (DEV-026 R4) — permission gating + aggregation for the
// reports page, plus the מבנה-אחיד (OPEN FORMAT) export orchestration.
//
// Gating:
//   reports.view    — owner + manager: read every report (JSON)
//   reports.export  — owner + manager: CSV downloads
//   invoices.export — OWNER ONLY: the legal מבנה-אחיד ZIP (books handover)
//
// Aggregations are pure functions over repository rows so they unit-test
// without mocks. Amounts stay integer agorot end-to-end.

// ============================================================
// נספח 1 — the official document-type table. The §2.6 books-validation
// report must list EVERY type here, with zeros for types the software does
// not manage ("אם המסמך לא מנוהל על ידי התוכנה יש למלא אפס").
// ============================================================

export const NISPACH1_DOC_TYPES: ReadonlyArray<{
  code: string;
  nameHe: string;
  managed: boolean;
}> = [
  { code: "100", nameHe: "הזמנה", managed: false },
  { code: "200", nameHe: "תעודת משלוח", managed: false },
  { code: "205", nameHe: "תעודת משלוח סוכן", managed: false },
  { code: "210", nameHe: "תעודת החזרה", managed: false },
  { code: "300", nameHe: "חשבונית/חשבונית עסקה", managed: false },
  { code: "305", nameHe: "חשבונית מס", managed: true },
  { code: "310", nameHe: "חשבונית ריכוז", managed: false },
  { code: "320", nameHe: "חשבונית מס/קבלה", managed: true },
  { code: "330", nameHe: "חשבונית מס זיכוי", managed: true },
  { code: "340", nameHe: "חשבונית שריון", managed: false },
  { code: "345", nameHe: "חשבונית סוכן", managed: false },
  { code: "400", nameHe: "קבלה", managed: true },
  { code: "405", nameHe: "קבלה על תרומות", managed: false },
  { code: "410", nameHe: "יציאה מקופה", managed: false },
  { code: "420", nameHe: "הפקדת בנק", managed: false },
  { code: "500", nameHe: "הזמנת רכש", managed: false },
  { code: "600", nameHe: "תעודת משלוח רכש", managed: false },
  { code: "610", nameHe: "החזרת רכש", managed: false },
  { code: "700", nameHe: "חשבונית מס רכש", managed: false },
  { code: "710", nameHe: "זיכוי רכש", managed: false },
  { code: "800", nameHe: "יתרת פתיחה", managed: false },
  { code: "810", nameHe: "כניסה כללית למלאי", managed: false },
  { code: "820", nameHe: "יציאה כללית מהמלאי", managed: false },
  { code: "830", nameHe: "העברה בין מחסנים", managed: false },
  { code: "840", nameHe: "עדכון בעקבות ספירה", managed: false },
  { code: "900", nameHe: "דוח ייצור - כניסה", managed: false },
  { code: "910", nameHe: "דוח ייצור - יציאה", managed: false },
];

// Service-side payment labels for CSV (the UI keeps its own copy in
// components/invoicing/labels.ts — importing a component module here would
// invert the layering).
const PAYMENT_METHOD_LABELS_HE: Record<number, string> = {
  1: "מזומן",
  2: "המחאה",
  3: "כרטיס אשראי",
  4: "העברה בנקאית",
  5: "תווי קנייה",
  6: "תלוש החלפה",
  7: "שטר",
  8: "הוראת קבע",
  9: "אחר",
};

const DOC_TYPE_LABELS_HE: Record<string, string> = Object.fromEntries(
  NISPACH1_DOC_TYPES.map((t) => [t.code, t.nameHe]),
);

// ============================================================
// DTO types
// ============================================================

export type DocTypeSummaryRow = {
  docType: string;
  nameHe: string;
  managed: boolean;
  /** All documents in range (including cancelled — they remain in the books). */
  count: number;
  cancelledCount: number;
  /** Sum of total_amount over NON-cancelled documents, in agorot. */
  totalAgorot: number;
};

export type SalesBookRow = {
  id: string;
  docType: string;
  docTypeLabel: string;
  number: number;
  docDate: string;
  buyerName: string | null;
  status: "issued" | "cancelled";
  netAgorot: number;
  vatAgorot: number;
  totalAgorot: number;
  /** total with the 330 sign applied (credit notes negative). */
  signedTotalAgorot: number;
};

export type SalesBookDTO = {
  rows: SalesBookRow[];
  totals: {
    documentCount: number; // non-cancelled
    netAgorot: number; // signed (330 negative)
    vatAgorot: number;
    totalAgorot: number;
  };
};

export type ReceiptsBookRow = {
  documentId: string;
  docType: string;
  docTypeLabel: string;
  number: number;
  docDate: string;
  buyerName: string | null;
  status: "issued" | "cancelled";
  paymentLineNo: number;
  method: number;
  methodLabel: string;
  dueDate: string | null;
  amountAgorot: number;
};

export type ReceiptsBookDTO = {
  rows: ReceiptsBookRow[];
  totalsByMethod: Array<{ method: number; methodLabel: string; amountAgorot: number }>;
  /** Non-cancelled receipt lines only. */
  totalAgorot: number;
  /** Sum of withholding (ניכוי במקור) on non-cancelled 400/320 documents. */
  withholdingAgorot: number;
};

export type VatSummaryRow = {
  month: string; // YYYY-MM
  salesNetAgorot: number; // 305+320, issued only
  salesVatAgorot: number;
  creditNetAgorot: number; // 330, issued only (positive magnitudes)
  creditVatAgorot: number;
  netAgorot: number; // sales − credit
  vatAgorot: number;
};

export type VatSummaryDTO = {
  rows: VatSummaryRow[];
  totals: Omit<VatSummaryRow, "month">;
};

export type ClientBalanceRow = {
  /** client_id when linked, else a name-derived key. */
  clientKey: string;
  buyerName: string;
  chargedAgorot: number; // 305+320 totals − 330 totals (issued only)
  receivedAgorot: number; // 400+320 totals + their withholding (issued only)
  withholdingAgorot: number;
  balanceAgorot: number; // charged − received
};

export type OpenFormatSummaryDTO = {
  business: { vatId: string; name: string };
  software: { name: string; version: string; registrationNumber: string | null };
  range: { from: string; to: string };
  generatedDate: string;
  generatedTime: string;
  savedPath: string;
  counts: { C100: number; D110: number; D120: number; total: number };
  documentCount: number;
  warnings: string[];
  fileName: string;
};

// ============================================================
// Pure aggregations (exported for unit tests)
// ============================================================

type IssuedDoc = InvoiceDocument & { number: number };

function issuedOnly(docs: InvoiceDocument[]): IssuedDoc[] {
  return docs.filter(
    (d): d is IssuedDoc => d.status === "issued" && d.number !== null,
  );
}

function withLegalNumber(docs: InvoiceDocument[]): IssuedDoc[] {
  return docs.filter((d): d is IssuedDoc => d.number !== null);
}

export function aggregateDocTypeSummary(
  docs: InvoiceDocument[],
): DocTypeSummaryRow[] {
  const byType = new Map<string, { count: number; cancelled: number; total: number }>();
  for (const d of withLegalNumber(docs)) {
    const agg = byType.get(d.doc_type) ?? { count: 0, cancelled: 0, total: 0 };
    agg.count += 1;
    if (d.status === "cancelled") agg.cancelled += 1;
    else agg.total += d.total_amount;
    byType.set(d.doc_type, agg);
  }
  return NISPACH1_DOC_TYPES.map((t) => {
    const agg = byType.get(t.code);
    return {
      docType: t.code,
      nameHe: t.nameHe,
      managed: t.managed,
      count: agg?.count ?? 0,
      cancelledCount: agg?.cancelled ?? 0,
      totalAgorot: agg?.total ?? 0,
    };
  });
}

const SALES_TYPES = new Set(["305", "320", "330"]);
const RECEIPT_TYPES = new Set(["320", "400"]);

export function buildSalesBook(docs: InvoiceDocument[]): SalesBookDTO {
  const rows: SalesBookRow[] = withLegalNumber(docs)
    .filter((d) => SALES_TYPES.has(d.doc_type))
    .sort((a, b) => a.doc_date.localeCompare(b.doc_date) || a.number - b.number)
    .map((d) => {
      const sign = d.doc_type === "330" ? -1 : 1;
      return {
        id: d.id,
        docType: d.doc_type,
        docTypeLabel: DOC_TYPE_LABELS_HE[d.doc_type] ?? d.doc_type,
        number: d.number,
        docDate: d.doc_date,
        buyerName: d.buyer_name,
        status: d.status as "issued" | "cancelled",
        netAgorot: d.net_amount,
        vatAgorot: d.vat_amount,
        totalAgorot: d.total_amount,
        signedTotalAgorot: sign * d.total_amount,
      };
    });

  const totals = { documentCount: 0, netAgorot: 0, vatAgorot: 0, totalAgorot: 0 };
  for (const r of rows) {
    if (r.status !== "issued") continue;
    const sign = r.docType === "330" ? -1 : 1;
    totals.documentCount += 1;
    totals.netAgorot += sign * r.netAgorot;
    totals.vatAgorot += sign * r.vatAgorot;
    totals.totalAgorot += sign * r.totalAgorot;
  }
  return { rows, totals };
}

export function buildReceiptsBook(
  docs: reportsRepo.DocumentWithChildren[],
): ReceiptsBookDTO {
  const receiptDocs = docs.filter(
    (d): d is reportsRepo.DocumentWithChildren & { number: number } =>
      d.number !== null && RECEIPT_TYPES.has(d.doc_type),
  );

  const rows: ReceiptsBookRow[] = [];
  for (const d of receiptDocs) {
    for (const p of [...d.document_payments].sort((a, b) => a.line_no - b.line_no)) {
      rows.push({
        documentId: d.id,
        docType: d.doc_type,
        docTypeLabel: DOC_TYPE_LABELS_HE[d.doc_type] ?? d.doc_type,
        number: d.number,
        docDate: d.doc_date,
        buyerName: d.buyer_name,
        status: d.status as "issued" | "cancelled",
        paymentLineNo: p.line_no,
        method: p.method,
        methodLabel: PAYMENT_METHOD_LABELS_HE[p.method] ?? String(p.method),
        dueDate: p.due_date,
        amountAgorot: p.amount,
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.docDate.localeCompare(b.docDate) ||
      a.number - b.number ||
      a.paymentLineNo - b.paymentLineNo,
  );

  const byMethod = new Map<number, number>();
  let totalAgorot = 0;
  for (const r of rows) {
    if (r.status !== "issued") continue;
    totalAgorot += r.amountAgorot;
    byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + r.amountAgorot);
  }
  let withholdingAgorot = 0;
  for (const d of receiptDocs) {
    if (d.status === "issued") withholdingAgorot += d.withholding_amount;
  }

  return {
    rows,
    totalsByMethod: [...byMethod.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([method, amountAgorot]) => ({
        method,
        methodLabel: PAYMENT_METHOD_LABELS_HE[method] ?? String(method),
        amountAgorot,
      })),
    totalAgorot,
    withholdingAgorot,
  };
}

export function aggregateVatSummary(docs: InvoiceDocument[]): VatSummaryDTO {
  const byMonth = new Map<string, VatSummaryRow>();
  for (const d of issuedOnly(docs)) {
    if (!SALES_TYPES.has(d.doc_type)) continue;
    const month = d.doc_date.slice(0, 7);
    const row =
      byMonth.get(month) ??
      ({
        month,
        salesNetAgorot: 0,
        salesVatAgorot: 0,
        creditNetAgorot: 0,
        creditVatAgorot: 0,
        netAgorot: 0,
        vatAgorot: 0,
      } satisfies VatSummaryRow);
    if (d.doc_type === "330") {
      row.creditNetAgorot += d.net_amount;
      row.creditVatAgorot += d.vat_amount;
    } else {
      row.salesNetAgorot += d.net_amount;
      row.salesVatAgorot += d.vat_amount;
    }
    row.netAgorot = row.salesNetAgorot - row.creditNetAgorot;
    row.vatAgorot = row.salesVatAgorot - row.creditVatAgorot;
    byMonth.set(month, row);
  }
  const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const totals = {
    salesNetAgorot: 0,
    salesVatAgorot: 0,
    creditNetAgorot: 0,
    creditVatAgorot: 0,
    netAgorot: 0,
    vatAgorot: 0,
  };
  for (const r of rows) {
    totals.salesNetAgorot += r.salesNetAgorot;
    totals.salesVatAgorot += r.salesVatAgorot;
    totals.creditNetAgorot += r.creditNetAgorot;
    totals.creditVatAgorot += r.creditVatAgorot;
    totals.netAgorot += r.netAgorot;
    totals.vatAgorot += r.vatAgorot;
  }
  return { rows, totals };
}

export function aggregateClientBalances(
  docs: InvoiceDocument[],
): ClientBalanceRow[] {
  type Acc = {
    buyerName: string;
    charged: number;
    received: number;
    withholding: number;
  };
  const byClient = new Map<string, Acc>();
  for (const d of issuedOnly(docs)) {
    const key = d.client_id ?? `name:${(d.buyer_name ?? "ללא שם").trim()}`;
    const acc =
      byClient.get(key) ??
      ({
        buyerName: (d.buyer_name ?? "ללא שם").trim(),
        charged: 0,
        received: 0,
        withholding: 0,
      } satisfies Acc);
    if (d.doc_type === "305" || d.doc_type === "320") acc.charged += d.total_amount;
    if (d.doc_type === "330") acc.charged -= d.total_amount;
    if (d.doc_type === "400" || d.doc_type === "320") {
      // הבהרה 4: a receipt's total excludes tax withheld at source — the
      // client settled that part too, so the balance credits both.
      acc.received += d.total_amount + d.withholding_amount;
      acc.withholding += d.withholding_amount;
    }
    byClient.set(key, acc);
  }
  return [...byClient.entries()]
    .map(([clientKey, acc]) => ({
      clientKey,
      buyerName: acc.buyerName,
      chargedAgorot: acc.charged,
      receivedAgorot: acc.received,
      withholdingAgorot: acc.withholding,
      balanceAgorot: acc.charged - acc.received,
    }))
    .sort((a, b) => b.balanceAgorot - a.balanceAgorot);
}

// ============================================================
// Session-facing reads
// ============================================================

async function loadRangeDocs(
  session: FullSession,
  range: ReportRangeQuery,
): Promise<InvoiceDocument[]> {
  const { rows, truncated } = await reportsRepo.findDocumentsInRange(
    session.organization.id,
    range.from,
    range.to,
  );
  if (truncated) {
    throw new ValidationError("Report range holds too many documents", {
      reason: "range_too_large",
    });
  }
  return rows;
}

export async function getDocTypeSummary(
  session: FullSession,
  range: ReportRangeQuery,
): Promise<DocTypeSummaryRow[]> {
  requireCapability(session, PERMISSIONS.REPORTS_VIEW);
  return aggregateDocTypeSummary(await loadRangeDocs(session, range));
}

export async function getSalesBook(
  session: FullSession,
  range: ReportRangeQuery,
): Promise<SalesBookDTO> {
  requireCapability(session, PERMISSIONS.REPORTS_VIEW);
  return buildSalesBook(await loadRangeDocs(session, range));
}

export async function getReceiptsBook(
  session: FullSession,
  range: ReportRangeQuery,
): Promise<ReceiptsBookDTO> {
  requireCapability(session, PERMISSIONS.REPORTS_VIEW);
  const { rows, truncated } = await reportsRepo.findDocumentsWithChildrenInRange(
    session.organization.id,
    range.from,
    range.to,
  );
  if (truncated) {
    throw new ValidationError("Report range holds too many documents", {
      reason: "range_too_large",
    });
  }
  return buildReceiptsBook(rows);
}

export async function getVatSummary(
  session: FullSession,
  range: ReportRangeQuery,
): Promise<VatSummaryDTO> {
  requireCapability(session, PERMISSIONS.REPORTS_VIEW);
  return aggregateVatSummary(await loadRangeDocs(session, range));
}

export async function getClientBalances(
  session: FullSession,
  range: ReportRangeQuery,
): Promise<ClientBalanceRow[]> {
  requireCapability(session, PERMISSIONS.REPORTS_VIEW);
  return aggregateClientBalances(await loadRangeDocs(session, range));
}

// ============================================================
// CSV (reports.export)
// ============================================================

/** Excel-friendly CSV: UTF-8 BOM (\uFEFF), CRLF, quoted cells. */
export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [headers.map(quote).join(","), ...rows.map((r) => r.map(quote).join(","))];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

function agorotToSheqelString(agorot: number): string {
  const sign = agorot < 0 ? "-" : "";
  const abs = Math.abs(agorot);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export type CsvFile = { content: string; fileName: string };

export async function getReportCsv(
  session: FullSession,
  report: "summary" | "sales" | "receipts" | "vat" | "client-balances",
  range: ReportRangeQuery,
): Promise<CsvFile> {
  requireCapability(session, PERMISSIONS.REPORTS_EXPORT);
  const suffix = `${range.from}_${range.to}`;

  switch (report) {
    case "summary": {
      const rows = await getDocTypeSummary(session, range);
      return {
        fileName: `doc-summary_${suffix}.csv`,
        content: toCsv(
          ["קוד מסמך", "סוג המסמך", "מנוהל בתוכנה", "כמות", "מתוכם מבוטלים", 'סה"כ כספי (₪)'],
          rows.map((r) => [
            r.docType,
            r.nameHe,
            r.managed ? "כן" : "לא",
            r.count,
            r.cancelledCount,
            agorotToSheqelString(r.totalAgorot),
          ]),
        ),
      };
    }
    case "sales": {
      const book = await getSalesBook(session, range);
      return {
        fileName: `sales-book_${suffix}.csv`,
        content: toCsv(
          ["תאריך", "סוג", "מספר", "לקוח", "סטטוס", 'לפני מע"מ (₪)', 'מע"מ (₪)', 'סה"כ (₪)'],
          book.rows.map((r) => [
            r.docDate,
            r.docTypeLabel,
            r.number,
            r.buyerName ?? "",
            r.status === "cancelled" ? "מבוטל" : "הופק",
            agorotToSheqelString(r.docType === "330" ? -r.netAgorot : r.netAgorot),
            agorotToSheqelString(r.docType === "330" ? -r.vatAgorot : r.vatAgorot),
            agorotToSheqelString(r.signedTotalAgorot),
          ]),
        ),
      };
    }
    case "receipts": {
      const book = await getReceiptsBook(session, range);
      return {
        fileName: `receipts-book_${suffix}.csv`,
        content: toCsv(
          ["תאריך", "סוג", "מספר", "משלם", "סטטוס", "אמצעי תשלום", "ת. פירעון", "סכום (₪)"],
          book.rows.map((r) => [
            r.docDate,
            r.docTypeLabel,
            r.number,
            r.buyerName ?? "",
            r.status === "cancelled" ? "מבוטל" : "הופק",
            r.methodLabel,
            r.dueDate ?? "",
            agorotToSheqelString(r.amountAgorot),
          ]),
        ),
      };
    }
    case "vat": {
      const vat = await getVatSummary(session, range);
      return {
        fileName: `vat-summary_${suffix}.csv`,
        content: toCsv(
          ["חודש", 'עסקאות לפני מע"מ (₪)', 'מע"מ עסקאות (₪)', "זיכויים לפני מע\"מ (₪)", 'מע"מ זיכויים (₪)', "נטו (₪)", 'מע"מ נטו (₪)'],
          vat.rows.map((r) => [
            r.month,
            agorotToSheqelString(r.salesNetAgorot),
            agorotToSheqelString(r.salesVatAgorot),
            agorotToSheqelString(r.creditNetAgorot),
            agorotToSheqelString(r.creditVatAgorot),
            agorotToSheqelString(r.netAgorot),
            agorotToSheqelString(r.vatAgorot),
          ]),
        ),
      };
    }
    case "client-balances": {
      const rows = await getClientBalances(session, range);
      return {
        fileName: `client-balances_${suffix}.csv`,
        content: toCsv(
          ["לקוח", "חיובים (₪)", "תקבולים (₪)", "מתוכם ניכוי במקור (₪)", "יתרה (₪)"],
          rows.map((r) => [
            r.buyerName,
            agorotToSheqelString(r.chargedAgorot),
            agorotToSheqelString(r.receivedAgorot),
            agorotToSheqelString(r.withholdingAgorot),
            agorotToSheqelString(r.balanceAgorot),
          ]),
        ),
      };
    }
  }
}

// ============================================================
// מבנה-אחיד export (invoices.export — owner only)
// ============================================================

function ilDateTimeParts(iso: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}${parts.minute}`,
  };
}

/** Normalize a stored business id to the 9-digit עוסק מורשה the spec wants. */
export function normalizeVatId(businessId: string): string {
  const digits = businessId.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 9) {
    throw new ValidationError("Business id must be a 9-digit עוסק/ח.פ number", {
      reason: "invalid_business_id",
    });
  }
  return digits.padStart(9, "0");
}

function random15Digits(): string {
  let out = "";
  for (let i = 0; i < 15; i++) out += String(randomInt(0, 10));
  return out;
}

/** Stable ≤15-char customer key for C100 field 1225. */
export function buyerKeyFor(doc: {
  client_id: string | null;
  buyer_tax_id: string | null;
  buyer_name: string | null;
}): string | null {
  const taxDigits = doc.buyer_tax_id?.replace(/\D/g, "") ?? "";
  if (taxDigits.length > 0) return taxDigits.slice(0, 15);
  if (doc.client_id) return `C${doc.client_id.replace(/-/g, "").slice(0, 12)}`;
  return doc.buyer_name?.trim().slice(0, 15) ?? null;
}

function docToOpenFormat(
  doc: reportsRepo.DocumentWithChildren & { number: number },
  baseDocsById: Map<string, { doc_type: string; number: number | null }>,
): OpenFormatDocument {
  const issued = doc.issued_at ? ilDateTimeParts(doc.issued_at) : null;
  const base = doc.base_document_id
    ? baseDocsById.get(doc.base_document_id) ?? null
    : null;
  const baseDocType = base?.doc_type ?? null;
  const baseDocNumber = base?.number != null ? String(base.number) : null;

  return {
    docType: doc.doc_type as OpenFormatDocument["docType"],
    number: doc.number,
    docDate: doc.doc_date,
    valueDate: doc.value_date,
    issueDate: issued?.date ?? doc.doc_date,
    issueTime: issued?.time ?? null,
    buyerName: doc.buyer_name,
    buyerAddress: doc.buyer_address,
    buyerPhone: doc.buyer_phone,
    buyerTaxId: doc.buyer_tax_id,
    buyerKey: buyerKeyFor(doc),
    cancelled: doc.status === "cancelled",
    amounts: {
      beforeDiscountAgorot: doc.amount_before_discount,
      discountAgorot: doc.discount_amount,
      netAgorot: doc.net_amount,
      vatAgorot: doc.vat_amount,
      totalAgorot: doc.total_amount,
      withholdingAgorot: doc.withholding_amount,
    },
    lines: [...doc.document_lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({
        lineNo: l.line_no,
        catalogId: l.catalog_id,
        description: l.description,
        unit: l.unit,
        quantity: String(l.quantity),
        unitPriceAgorot: l.unit_price,
        lineDiscountAgorot: l.line_discount,
        lineTotalAgorot: l.line_total,
        vatRateBp: doc.vat_rate_bp ?? 0,
        baseDocType,
        baseDocNumber,
      })),
    payments: [...doc.document_payments]
      .sort((a, b) => a.line_no - b.line_no)
      .map((p) => ({
        lineNo: p.line_no,
        method: p.method,
        amountAgorot: p.amount,
        dueDate: p.due_date,
        bankNo: p.bank_no,
        branchNo: p.branch_no,
        accountNo: p.account_no,
        chequeNo: p.cheque_no,
        cardCompany: p.card_company,
        cardTxType: p.card_tx_type,
      })),
  };
}

async function assembleOpenFormat(
  session: FullSession,
  range: ReportRangeQuery,
): Promise<{
  input: OpenFormatInput;
  documentCount: number;
  businessName: string;
  serviceWarnings: string[];
}> {
  const ledger = await ledgersRepo.findSelfByOrgId(session.organization.id);
  if (!ledger) {
    throw new ValidationError("Self ledger not found", { reason: "no_ledger" });
  }
  if (!ledger.business_id) {
    throw new ValidationError(
      "Business id (עוסק/ח.פ) is required before exporting",
      { reason: "business_id_missing" },
    );
  }
  const vatId = normalizeVatId(ledger.business_id);

  // The spec forbids a FUTURE end date in field 1025 (simulator: "התאריך לא
  // יכול להיות עתידי") — clamp the export cut to the production date and keep
  // the queried documents consistent with the declared range.
  const generatedIso = new Date().toISOString();
  const generated = ilDateTimeParts(generatedIso);
  const serviceWarnings: string[] = [];
  let effectiveTo = range.to;
  if (effectiveTo > generated.date) {
    effectiveTo = generated.date;
    serviceWarnings.push(
      "תאריך הסיום של הטווח קוצר ליום ההפקה — ההוראות אוסרות תאריך עתידי בקובץ.",
    );
  }
  if (range.from > effectiveTo) {
    throw new ValidationError("Export range starts in the future", {
      reason: "range_in_future",
    });
  }

  const { rows, truncated } = await reportsRepo.findDocumentsWithChildrenInRange(
    session.organization.id,
    range.from,
    effectiveTo,
  );
  if (truncated) {
    throw new ValidationError("Export range holds too many documents", {
      reason: "range_too_large",
    });
  }
  const docs = rows.filter(
    (d): d is reportsRepo.DocumentWithChildren & { number: number } =>
      d.number !== null,
  );

  // Resolve base-document references (330 → the credited document), which may
  // live outside the exported range.
  const baseIds = [
    ...new Set(
      docs
        .map((d) => d.base_document_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const baseDocsById = new Map<string, { doc_type: string; number: number | null }>();
  for (const d of docs) baseDocsById.set(d.id, { doc_type: d.doc_type, number: d.number });
  const missingBaseIds = baseIds.filter((id) => !baseDocsById.has(id));
  if (missingBaseIds.length > 0) {
    const bases = await reportsRepo.findDocumentsByIds(
      session.organization.id,
      missingBaseIds,
    );
    for (const b of bases) baseDocsById.set(b.id, { doc_type: b.doc_type, number: b.number });
  }

  const dirSegment =
    generated.date.slice(5, 7) + generated.date.slice(8, 10) + generated.time;

  const input: OpenFormatInput = {
    business: {
      vatId,
      name: ledger.legal_name,
      companyId: ledger.business_type === "ltd" ? vatId : null,
      deductionsFileId: null,
      addressStreet: ledger.address_street,
      addressCity: ledger.address_city,
      addressZip: ledger.address_zip,
    },
    software: {
      registrationNumber: process.env.SOFTWARE_REG_NUMBER?.replace(/\D/g, "") || null,
      name: process.env.SOFTWARE_NAME || "AVI.APP",
      version: process.env.SOFTWARE_VERSION || "1.0",
      producerVatId: process.env.SOFTWARE_PRODUCER_VATID?.replace(/\D/g, "") || null,
      producerName: process.env.SOFTWARE_PRODUCER_NAME || null,
    },
    dateFrom: range.from,
    dateTo: effectiveTo,
    generatedDate: generated.date,
    generatedTime: generated.time,
    generatedDirSegment: dirSegment,
    primaryId: random15Digits(),
    documents: docs.map((d) => docToOpenFormat(d, baseDocsById)),
  };

  return {
    input,
    documentCount: docs.length,
    businessName: ledger.legal_name,
    serviceWarnings,
  };
}

export async function getOpenFormatSummary(
  session: FullSession,
  range: ReportRangeQuery,
): Promise<OpenFormatSummaryDTO> {
  requireCapability(session, PERMISSIONS.INVOICES_EXPORT);
  const { input, documentCount, businessName, serviceWarnings } =
    await assembleOpenFormat(session, range);
  const build = buildOpenFormat(input);
  return {
    business: { vatId: input.business.vatId, name: businessName },
    software: {
      name: input.software.name,
      version: input.software.version,
      registrationNumber: input.software.registrationNumber,
    },
    // The DTO reflects what the FILE declares (1024/1025) — i.e. the clamped
    // range, not the raw request.
    range: { from: input.dateFrom, to: input.dateTo },
    generatedDate: input.generatedDate,
    generatedTime: input.generatedTime,
    savedPath: build.savedPath,
    counts: build.counts,
    documentCount,
    warnings: [...serviceWarnings, ...build.warnings],
    fileName: openFormatFileName(input.business.vatId, {
      from: input.dateFrom,
      to: input.dateTo,
    }),
  };
}

function openFormatFileName(vatId: string, range: ReportRangeQuery): string {
  return `openformat_${vatId}_${range.from}_${range.to}.zip`;
}

export async function exportOpenFormatZip(
  session: FullSession,
  range: ReportRangeQuery,
): Promise<{ buffer: Buffer; fileName: string }> {
  requireCapability(session, PERMISSIONS.INVOICES_EXPORT);
  const { input } = await assembleOpenFormat(session, range);
  const build = buildOpenFormat(input);
  const buffer = await zipOpenFormat(build);
  return {
    buffer,
    fileName: openFormatFileName(input.business.vatId, {
      from: input.dateFrom,
      to: input.dateTo,
    }),
  };
}
