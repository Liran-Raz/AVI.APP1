import { z } from "zod";

// Mirrors the DB enum `business_type` from 0001_initial_schema.sql.
// Order is not load-bearing for storage but is used by the UI dropdown,
// so keep it deliberate.
export const BUSINESS_TYPES = [
  "patur",
  "murshe",
  "ltd",
  "amuta",
  "agudat_shitufit",
] as const;

export const businessTypeSchema = z.enum(BUSINESS_TYPES);
export type BusinessTypeValue = z.infer<typeof businessTypeSchema>;

// ============================================================
// Field-level schemas
// ============================================================

const nameField = z
  .string()
  .trim()
  .min(1, "Client name is required")
  .max(200, "Client name is too long");

const taxIdField = z.string().trim().max(50, "Tax ID is too long");
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254, "Email is too long");
const phoneField = z.string().trim().max(50, "Phone is too long");
const addressField = z.string().trim().max(500, "Address is too long");
const notesField = z.string().trim().max(5000, "Notes are too long");

// Optional + nullable wrapper. Treats "" as null so users can clear a field
// by submitting an empty input. Missing keys stay missing (important for
// PATCH semantics: only update fields the client explicitly sends).
function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());
}

// ============================================================
// Create / Update payloads (JSON body)
// ============================================================

export const createClientSchema = z.object({
  name: nameField,
  businessType: optionalNullable(businessTypeSchema),
  taxId: optionalNullable(taxIdField),
  email: optionalNullable(emailField),
  phone: optionalNullable(phoneField),
  address: optionalNullable(addressField),
  notes: optionalNullable(notesField),
});

export const updateClientSchema = z
  .object({
    name: nameField.optional(),
    businessType: optionalNullable(businessTypeSchema),
    taxId: optionalNullable(taxIdField),
    email: optionalNullable(emailField),
    phone: optionalNullable(phoneField),
    address: optionalNullable(addressField),
    notes: optionalNullable(notesField),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field is required for update",
  });

// ============================================================
// List query string
// ============================================================

// Sanitize the free-text search term:
//   - strip PostgREST .or() separators (commas, parens, quotes)
//   - strip ILIKE wildcards so users can't inject % / _ on us
//   - trim + cap length
// 300 clients makes proper LIKE escaping overkill; stripping these chars
// gives a literal substring search that's plenty for Round A.
const searchField = z.preprocess(
  (v) => {
    if (typeof v !== "string") return undefined;
    const cleaned = v
      .trim()
      .replace(/[,()"'\\%_*]/g, "")
      .slice(0, 100);
    return cleaned.length > 0 ? cleaned : undefined;
  },
  z.string().min(1).max(100).optional(),
);

const statusField = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? "active" : v),
  z.enum(["active", "archived", "all"]).default("active"),
);

const limitField = z.preprocess(
  (v) => (typeof v === "string" && v.length > 0 ? Number(v) : v),
  z.number().int().min(1).max(200).default(100),
);

const offsetField = z.preprocess(
  (v) => (typeof v === "string" && v.length > 0 ? Number(v) : v),
  z.number().int().min(0).default(0),
);

export const listClientsQuerySchema = z.object({
  search: searchField,
  businessType: businessTypeSchema.optional(),
  status: statusField,
  limit: limitField,
  offset: offsetField,
});

// ============================================================
// Path params
// ============================================================

export const clientIdParamSchema = z.object({
  id: z.string().uuid("Invalid client id"),
});

// ============================================================
// Inferred types
// ============================================================

export type CreateClientPayload = z.infer<typeof createClientSchema>;
export type UpdateClientPayload = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type ClientIdParam = z.infer<typeof clientIdParamSchema>;
