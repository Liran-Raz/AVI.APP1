import { describe, expect, it } from "vitest";
import { createDocumentSchema } from "./documents.schema";

// Regression suite: exact wizard payload shapes (post-JSON: undefined keys
// dropped) must parse. Born from a live-QA 400 — quantity 2.4 was rejected by
// a float-fragile Number.isInteger(q*10000) check (2.4*10000 =
// 24000.000000000004). Keep the decimal cases.
const LEDGER = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";

function j(o: unknown) {
  return JSON.parse(JSON.stringify(o));
}

const variants: Record<string, unknown> = {
  "305 with client": {
    ledgerId: LEDGER, docType: "305", clientId: CLIENT, buyerName: undefined,
    docDate: "2026-07-16", valueDate: undefined, notes: undefined,
    discount: 0, withholding: 0,
    lines: [{ description: "שירות", quantity: 1, unitPrice: 10000, lineDiscount: 0 }],
    payments: [],
  },
  "305 manual buyer": {
    ledgerId: LEDGER, docType: "305", clientId: null, buyerName: "דוד",
    docDate: "2026-07-16", discount: 0, withholding: 0,
    lines: [{ description: "שירות", quantity: 1.5, unitPrice: 333, lineDiscount: 0 }],
    payments: [],
  },
  "400 receipt bank-transfer": {
    ledgerId: LEDGER, docType: "400", clientId: CLIENT,
    docDate: "2026-07-16", discount: 0, withholding: 0, lines: [],
    payments: [{ method: 4, amount: 50000, dueDate: null, bankNo: null, branchNo: null, accountNo: null, chequeNo: null, cardCompany: null, cardTxType: null, reference: null }],
  },
  "320 lines+payment": {
    ledgerId: LEDGER, docType: "320", clientId: CLIENT,
    docDate: "2026-07-16", discount: 0, withholding: 0,
    lines: [{ description: "x", quantity: 1, unitPrice: 10000, lineDiscount: 0 }],
    payments: [{ method: 1, amount: 11800, dueDate: null, bankNo: null, branchNo: null, accountNo: null, chequeNo: null, cardCompany: null, cardTxType: null, reference: null }],
  },
  "notes present": {
    ledgerId: LEDGER, docType: "305", clientId: CLIENT,
    docDate: "2026-07-16", notes: "הערה", discount: 0, withholding: 0,
    lines: [{ description: "x", quantity: 1, unitPrice: 100, lineDiscount: 0 }],
    payments: [],
  },
  "quantity 3 decimals": {
    ledgerId: LEDGER, docType: "305", clientId: CLIENT,
    docDate: "2026-07-16", discount: 0, withholding: 0,
    lines: [{ description: "x", quantity: 0.333, unitPrice: 100, lineDiscount: 0 }],
    payments: [],
  },
  "quantity 2.4 (float-artifact regression)": {
    ledgerId: LEDGER, docType: "305", clientId: CLIENT,
    docDate: "2026-07-16", discount: 0, withholding: 0,
    lines: [{ description: "x", quantity: 2.4, unitPrice: 100, lineDiscount: 0 }],
    payments: [],
  },
  "standalone credit note (330, no base)": {
    ledgerId: LEDGER, docType: "330", clientId: CLIENT,
    docDate: "2026-07-16", discount: 0, withholding: 0,
    lines: [{ description: "זיכוי", quantity: 1, unitPrice: 5000, lineDiscount: 0 }],
    payments: [],
  },
};

describe("wizard payload replay", () => {
  for (const [name, payload] of Object.entries(variants)) {
    it(name, () => {
      const res = createDocumentSchema.safeParse(j(payload));
      if (!res.success) {
        console.log(`FAIL [${name}]:`, JSON.stringify(res.error.issues, null, 1));
      }
      expect(res.success).toBe(true);
    });
  }
});
