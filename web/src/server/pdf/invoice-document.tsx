import "server-only";
import { createElement as h } from "react";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import { formatAgorot } from "@/lib/money";
import type { DocumentDTO } from "@/server/services/documents.service";
import type { LedgerDTO } from "@/server/services/ledgers.service";
import { PDF_FONT_FAMILY } from "./fonts";

// The tax-document PDF (DEV-026 R3). Hebrew RTL is done with row-reverse rows
// + textAlign:right; amounts/numbers are LTR runs. Rendered server-side to a
// Buffer. Deterministic from the FROZEN document snapshot — the same issued
// doc always produces the same content (signed-bytes persistence lands in R6).

const DOC_TYPE_HE: Record<DocumentDTO["docType"], string> = {
  "305": "חשבונית מס",
  "320": "חשבונית מס-קבלה",
  "330": "חשבונית זיכוי",
  "400": "קבלה",
};

const PAY_METHOD_HE: Record<number, string> = {
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

const NAVY = "#0d1c32";
const INK = "#191c1e";
const MUTED = "#44474d";
const LINE = "#c5c6cd";

const s = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 10,
    color: INK,
    paddingVertical: 40,
    paddingHorizontal: 44,
  },
  headerRow: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: { fontSize: 20, fontWeight: "bold", color: NAVY, textAlign: "right" },
  docMeta: { fontSize: 9, color: MUTED, textAlign: "right", marginTop: 3 },
  copyStamp: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#0054cc",
    borderWidth: 1,
    borderColor: "#0054cc",
    borderRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  cancelledStamp: { color: "#ba1a1a", borderColor: "#ba1a1a" },
  divider: { borderTopWidth: 2, borderColor: NAVY, marginTop: 12 },
  parties: { flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 16 },
  party: { width: "48%" },
  partyLabel: { fontSize: 8, color: MUTED, textAlign: "right", marginBottom: 3 },
  partyName: { fontSize: 11, fontWeight: "bold", textAlign: "right" },
  partyLine: { fontSize: 9.5, color: MUTED, textAlign: "right", marginTop: 1 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: "bold",
    color: NAVY,
    textAlign: "right",
    marginTop: 20,
    marginBottom: 4,
  },
  tHead: {
    flexDirection: "row-reverse",
    backgroundColor: "#f2f4f6",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tHeadText: { fontSize: 8.5, color: MUTED, fontWeight: "bold" },
  tRow: {
    flexDirection: "row-reverse",
    borderBottomWidth: 1,
    borderColor: LINE,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  cDesc: { width: "46%", textAlign: "right" },
  cQty: { width: "14%", textAlign: "center" },
  cPrice: { width: "20%", textAlign: "left" },
  cTotal: { width: "20%", textAlign: "left" },
  pMethod: { width: "40%", textAlign: "right" },
  pRef: { width: "36%", textAlign: "right", fontSize: 8.5, color: MUTED },
  pAmount: { width: "24%", textAlign: "left" },
  totals: { marginTop: 16, alignSelf: "flex-start", width: "45%" },
  totalRow: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalGrand: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    paddingVertical: 5,
    marginTop: 3,
    borderTopWidth: 1,
    borderColor: LINE,
  },
  grandText: { fontSize: 12, fontWeight: "bold" },
  muted: { color: MUTED },
  notes: {
    marginTop: 18,
    fontSize: 9,
    color: MUTED,
    textAlign: "right",
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 4,
    padding: 8,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 44,
    right: 44,
    textAlign: "center",
    fontSize: 8,
    color: MUTED,
  },
  cancelBanner: {
    marginTop: 12,
    backgroundColor: "#fdecea",
    borderWidth: 1,
    borderColor: "#ba1a1a",
    borderRadius: 4,
    padding: 8,
    fontSize: 9.5,
    color: "#ba1a1a",
    textAlign: "right",
  },
});

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function joinAddress(parts: (string | null)[]): string {
  return parts.filter((p) => p && p.trim().length > 0).join(", ");
}

type CopyKind = "original" | "copy";

export function InvoicePdf({
  doc,
  ledger,
  copy,
}: {
  doc: DocumentDTO;
  ledger: LedgerDTO;
  copy: CopyKind;
}) {
  const hasLines = doc.lines.length > 0;
  const hasPayments = doc.payments.length > 0;
  const withVat =
    doc.docType === "305" || doc.docType === "320" || doc.docType === "330";
  const isCancelled = doc.status === "cancelled";

  const stampText = isCancelled ? "מבוטל" : copy === "original" ? "מקור" : "העתק";

  const sellerName = doc.sellerLegalName ?? ledger.legalName;
  const sellerId = doc.sellerBusinessId ?? ledger.businessId;
  const sellerAddress = joinAddress([
    doc.sellerAddressStreet ?? ledger.addressStreet,
    doc.sellerAddressCity ?? ledger.addressCity,
    doc.sellerAddressZip ?? ledger.addressZip,
  ]);

  return h(
    Document,
    { title: `${DOC_TYPE_HE[doc.docType]} ${doc.number ?? ""}`.trim() } as never,
    h(
      Page,
      { size: "A4", style: s.page } as never,

      // ---- header ----
      h(
        View,
        { style: s.headerRow } as never,
        h(
          View,
          null,
          h(
            Text,
            { style: s.title } as never,
            `${DOC_TYPE_HE[doc.docType]}${doc.number !== null ? ` #${doc.number}` : ""}`,
          ),
          h(Text, { style: s.docMeta } as never, `תאריך: ${fmtDate(doc.docDate)}`),
          doc.allocationNumber
            ? h(
                Text,
                { style: s.docMeta } as never,
                `מספר הקצאה: ${doc.allocationNumber}`,
              )
            : null,
        ),
        h(
          Text,
          {
            style: [s.copyStamp, isCancelled ? s.cancelledStamp : undefined],
          } as never,
          stampText,
        ),
      ),
      h(View, { style: s.divider } as never),

      isCancelled
        ? h(
            Text,
            { style: s.cancelBanner } as never,
            `מסמך זה בוטל${doc.cancelReason ? ` — ${doc.cancelReason}` : ""}.`,
          )
        : null,

      doc.baseDocumentNumber !== null
        ? h(
            Text,
            { style: [s.partyLine, { marginTop: 8 }] } as never,
            `זיכוי עבור ${doc.baseDocumentType ? DOC_TYPE_HE[doc.baseDocumentType] : "מסמך"} #${doc.baseDocumentNumber}`,
          )
        : null,

      // ---- parties ----
      h(
        View,
        { style: s.parties } as never,
        h(
          View,
          { style: s.party } as never,
          h(Text, { style: s.partyLabel } as never, "מאת"),
          h(Text, { style: s.partyName } as never, sellerName),
          sellerId ? h(Text, { style: s.partyLine } as never, `עוסק/ח.פ ${sellerId}`) : null,
          sellerAddress ? h(Text, { style: s.partyLine } as never, sellerAddress) : null,
        ),
        h(
          View,
          { style: s.party } as never,
          h(Text, { style: s.partyLabel } as never, "לכבוד"),
          h(Text, { style: s.partyName } as never, doc.buyerName ?? "—"),
          doc.buyerTaxId ? h(Text, { style: s.partyLine } as never, `ע.מ/ח.פ ${doc.buyerTaxId}`) : null,
          doc.buyerAddress ? h(Text, { style: s.partyLine } as never, doc.buyerAddress) : null,
        ),
      ),

      // ---- lines ----
      hasLines
        ? h(
            View,
            null,
            h(Text, { style: s.sectionTitle } as never, "פירוט"),
            h(
              View,
              { style: s.tHead } as never,
              h(Text, { style: [s.cDesc, s.tHeadText] } as never, "תיאור"),
              h(Text, { style: [s.cQty, s.tHeadText] } as never, "כמות"),
              h(Text, { style: [s.cPrice, s.tHeadText] } as never, "מחיר ליח׳"),
              h(Text, { style: [s.cTotal, s.tHeadText] } as never, "סה״כ"),
            ),
            ...doc.lines.map((l) =>
              h(
                View,
                { style: s.tRow, key: l.id } as never,
                h(Text, { style: s.cDesc } as never, l.description),
                h(Text, { style: s.cQty } as never, String(l.quantity)),
                h(Text, { style: s.cPrice } as never, formatAgorot(l.unitPrice)),
                h(Text, { style: s.cTotal } as never, formatAgorot(l.lineTotal)),
              ),
            ),
          )
        : null,

      // ---- payments ----
      hasPayments
        ? h(
            View,
            null,
            h(Text, { style: s.sectionTitle } as never, "תקבולים"),
            h(
              View,
              { style: s.tHead } as never,
              h(Text, { style: [s.pMethod, s.tHeadText] } as never, "אמצעי תשלום"),
              h(Text, { style: [s.pRef, s.tHeadText] } as never, "פרטים"),
              h(Text, { style: [s.pAmount, s.tHeadText] } as never, "סכום"),
            ),
            ...doc.payments.map((p) =>
              h(
                View,
                { style: s.tRow, key: p.id } as never,
                h(Text, { style: s.pMethod } as never, PAY_METHOD_HE[p.method] ?? "אחר"),
                h(
                  Text,
                  { style: s.pRef } as never,
                  p.chequeNo
                    ? `בנק ${p.bankNo ?? ""} סניף ${p.branchNo ?? ""} חשב׳ ${p.accountNo ?? ""} המחאה ${p.chequeNo}`
                    : p.dueDate
                      ? `לפירעון ${fmtDate(p.dueDate)}`
                      : "",
                ),
                h(Text, { style: s.pAmount } as never, formatAgorot(p.amount)),
              ),
            ),
          )
        : null,

      // ---- totals ----
      h(
        View,
        { style: s.totals } as never,
        withVat
          ? h(
              View,
              null,
              h(
                View,
                { style: s.totalRow } as never,
                h(Text, { style: s.muted } as never, "סה״כ לפני מע״מ"),
                h(Text, null, formatAgorot(doc.netAmount)),
              ),
              h(
                View,
                { style: s.totalRow } as never,
                h(
                  Text,
                  { style: s.muted } as never,
                  `מע״מ${doc.vatRateBp !== null ? ` ${doc.vatRateBp / 100}%` : ""}`,
                ),
                h(Text, null, formatAgorot(doc.vatAmount)),
              ),
            )
          : null,
        h(
          View,
          { style: s.totalGrand } as never,
          h(Text, { style: s.grandText } as never, "סה״כ"),
          h(Text, { style: s.grandText } as never, formatAgorot(doc.totalAmount)),
        ),
        doc.withholdingAmount > 0
          ? h(
              View,
              { style: s.totalRow } as never,
              h(Text, { style: s.muted } as never, "ניכוי מס במקור"),
              h(Text, null, formatAgorot(doc.withholdingAmount)),
            )
          : null,
      ),

      doc.notes ? h(Text, { style: s.notes } as never, doc.notes) : null,

      h(
        Text,
        { style: s.footer, fixed: true } as never,
        "הופק באמצעות AVI.APP",
      ),
    ),
  );
}
