import { z } from "zod";

// DEV-026 R2 — tax-document (draft) validation. All money fields are integer
// AGOROT. Lines/payments arrive as full arrays (replace-all semantics on
// update — simple and safe for drafts; issue-time math is server/DB-side).

export const DOC_TYPES = ["305", "320", "330", "400"] as const;
export const docTypeSchema = z.enum(DOC_TYPES);
export type DocTypeValue = z.infer<typeof docTypeSchema>;

// Payment methods per מבנה אחיד D120 field 1306.
export const PAYMENT_METHODS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const agorotField = z.number().int().min(0).max(9_999_999_999_999); // ≤ ~₪100B
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());
}

// ============================================================
// Lines (D110) + payments (D120)
// ============================================================

export const documentLineSchema = z.object({
  description: z.string().trim().min(1, "Line description is required").max(200),
  catalogId: optionalNullable(z.string().trim().max(20)),
  unit: optionalNullable(z.string().trim().max(20)),
  quantity: z
    .number()
    .positive("Quantity must be positive")
    .max(999_999_999)
    // Float-safe 4-decimal check: q*10000 may land at 24000.000000000004 for
    // a perfectly valid 2.4, so compare against the rounded value with an
    // epsilon instead of Number.isInteger (which rejected such inputs).
    .refine((q) => Math.abs(q * 10000 - Math.round(q * 10000)) < 1e-6, {
      message: "Quantity supports up to 4 decimal places",
    }),
  unitPrice: agorotField, // agorot, ex-VAT
  lineDiscount: agorotField.optional().default(0),
});

export const documentPaymentSchema = z
  .object({
    method: z.number().int().min(1).max(9),
    amount: agorotField.min(1, "Payment amount must be positive"),
    dueDate: optionalNullable(dateField),
    bankNo: optionalNullable(z.string().trim().max(10)),
    branchNo: optionalNullable(z.string().trim().max(10)),
    accountNo: optionalNullable(z.string().trim().max(15)),
    chequeNo: optionalNullable(z.string().trim().max(10)),
    cardCompany: optionalNullable(z.number().int().min(1).max(6)),
    cardTxType: optionalNullable(z.number().int().min(1).max(5)),
    reference: optionalNullable(z.string().trim().max(50)),
  })
  .refine(
    (p) =>
      p.method !== 2 ||
      Boolean(p.bankNo && p.branchNo && p.accountNo && p.chequeNo),
    {
      message:
        "Cheque payments require bank, branch, account and cheque numbers (מבנה אחיד D120)",
    },
  );

// ============================================================
// Create / update draft
// ============================================================

const buyerNameField = z.string().trim().min(1).max(50); // C100 1207 is X(50)

export const createDocumentSchema = z
  .object({
    ledgerId: z.string().uuid("Invalid ledger id"),
    docType: docTypeSchema,
    clientId: optionalNullable(z.string().uuid("Invalid client id")),
    buyerName: optionalNullable(buyerNameField),
    docDate: dateField,
    valueDate: optionalNullable(dateField),
    notes: optionalNullable(z.string().trim().max(1000)),
    discount: agorotField.optional().default(0), // document-level discount
    withholding: agorotField.optional().default(0), // ניכוי במקור (receipts)
    lines: z.array(documentLineSchema).max(100).default([]),
    payments: z.array(documentPaymentSchema).max(50).default([]),
  })
  .refine((d) => d.clientId || d.buyerName, {
    message: "Either a client or a buyer name is required",
  });

export const updateDocumentSchema = z
  .object({
    clientId: optionalNullable(z.string().uuid("Invalid client id")),
    buyerName: optionalNullable(buyerNameField),
    docDate: dateField.optional(),
    valueDate: optionalNullable(dateField),
    notes: optionalNullable(z.string().trim().max(1000)),
    discount: agorotField.optional(),
    withholding: agorotField.optional(),
    lines: z.array(documentLineSchema).max(100).optional(), // replace-all
    payments: z.array(documentPaymentSchema).max(50).optional(), // replace-all
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field is required for update",
  });

// ============================================================
// Actions / list / params
// ============================================================

export const cancelDocumentSchema = z.object({
  reason: z.string().trim().min(1, "Cancel reason is required").max(300),
});

const searchField = z.preprocess(
  (v) => {
    if (typeof v !== "string") return undefined;
    const cleaned = v.trim().replace(/[,()"'\\%_*]/g, "").slice(0, 100);
    return cleaned.length > 0 ? cleaned : undefined;
  },
  z.string().min(1).max(100).optional(),
);

const limitField = z.preprocess(
  (v) => (typeof v === "string" && v.length > 0 ? Number(v) : v),
  z.number().int().min(1).max(200).default(50),
);

const offsetField = z.preprocess(
  (v) => (typeof v === "string" && v.length > 0 ? Number(v) : v),
  z.number().int().min(0).default(0),
);

export const listDocumentsQuerySchema = z.object({
  docType: docTypeSchema.optional(),
  status: z.enum(["draft", "issued", "cancelled", "all"]).default("all"),
  search: searchField, // buyer name / document number
  limit: limitField,
  offset: offsetField,
});

export const documentIdParamSchema = z.object({
  id: z.string().uuid("Invalid document id"),
});

// ============================================================
// Inferred types
// ============================================================

export type DocumentLinePayload = z.infer<typeof documentLineSchema>;
export type DocumentPaymentPayload = z.infer<typeof documentPaymentSchema>;
export type CreateDocumentPayload = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentPayload = z.infer<typeof updateDocumentSchema>;
export type CancelDocumentPayload = z.infer<typeof cancelDocumentSchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
