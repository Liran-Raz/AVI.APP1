import { z } from "zod";

// ============================================================
// Field-level schemas
// ============================================================

const nameField = z
  .string()
  .trim()
  .min(1, "Contact name is required")
  .max(200, "Contact name is too long");

// `role` here describes a job title at the client's organization
// (e.g., "מנהלת כספים") — NOT a system role like UserRole.
const roleField = z.string().trim().max(100, "Role is too long");
const phoneField = z.string().trim().max(50, "Phone is too long");
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254, "Email is too long");

function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());
}

// ============================================================
// Create / Update payloads (JSON body)
// ============================================================

export const createContactSchema = z.object({
  name: nameField,
  role: optionalNullable(roleField),
  phone: optionalNullable(phoneField),
  email: optionalNullable(emailField),
  isPrimary: z.boolean().optional(), // DB default is false
}).strict();

export const updateContactSchema = z
  .object({
    name: nameField.optional(),
    role: optionalNullable(roleField),
    phone: optionalNullable(phoneField),
    email: optionalNullable(emailField),
    isPrimary: z.boolean().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field is required for update",
  });

// ============================================================
// Path params
// ============================================================

export const contactRouteParamsSchema = z.object({
  clientId: z.string().uuid("Invalid client id"),
  contactId: z.string().uuid("Invalid contact id"),
});

export const contactClientOnlyParamsSchema = z.object({
  clientId: z.string().uuid("Invalid client id"),
});

// ============================================================
// Inferred types
// ============================================================

export type CreateContactPayload = z.infer<typeof createContactSchema>;
export type UpdateContactPayload = z.infer<typeof updateContactSchema>;
