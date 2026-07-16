import { z } from "zod";

import { businessTypeSchema } from "./clients.schema";

// DEV-026 R1 — ledgers (בתי-עסק) business-profile validation.
// The ledger holds the legal/tax identity that prints on tax documents
// (חשבונית מס / קבלה / ...) and feeds the מבנה אחיד INI.TXT identity fields.

// ============================================================
// Field-level schemas
// ============================================================

const legalNameField = z
  .string()
  .trim()
  .min(1, "Legal name is required")
  .max(100, "Legal name is too long"); // mirrors ledgers_legal_name_len (1..100)

const tradeNameField = z.string().trim().max(100, "Trade name is too long");

// עוסק מורשה / ח.פ — exactly 9 digits (mirrors ledgers_business_id_format).
const businessIdField = z
  .string()
  .trim()
  .regex(/^[0-9]{9}$/, "Business id must be exactly 9 digits");

const addressField = z.string().trim().max(200, "Address is too long");
const cityField = z.string().trim().max(100, "City is too long");
const zipField = z
  .string()
  .trim()
  .regex(/^[0-9]{5,7}$/, "Zip must be 5-7 digits");
const phoneField = z.string().trim().max(50, "Phone is too long");
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254, "Email is too long");

// Optional + nullable wrapper ("" clears the field; missing keys stay missing —
// PATCH semantics). Same helper shape as clients.schema.ts.
function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());
}

// ============================================================
// Update payload (JSON body) — the business profile form.
// legal_name cannot be cleared (NOT NULL in the DB), only replaced.
// ============================================================

export const updateLedgerSchema = z
  .object({
    legalName: legalNameField.optional(),
    tradeName: optionalNullable(tradeNameField),
    businessId: optionalNullable(businessIdField),
    businessType: optionalNullable(businessTypeSchema),
    addressStreet: optionalNullable(addressField),
    addressCity: optionalNullable(cityField),
    addressZip: optionalNullable(zipField),
    phone: optionalNullable(phoneField),
    email: optionalNullable(emailField),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field is required for update",
  });

// ============================================================
// Path params
// ============================================================

export const ledgerIdParamSchema = z.object({
  id: z.string().uuid("Invalid ledger id"),
});

// ============================================================
// Inferred types
// ============================================================

export type UpdateLedgerPayload = z.infer<typeof updateLedgerSchema>;
export type LedgerIdParam = z.infer<typeof ledgerIdParamSchema>;
