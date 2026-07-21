import { z } from "zod";

import { orgNameField } from "./onboarding.schema";

// Field shapes mirror the clients validator (same DB column semantics).
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254, "Email is too long");
const phoneField = z.string().trim().max(50, "Phone is too long");
const addressField = z.string().trim().max(500, "Address is too long");

// Optional + nullable wrapper — "" clears the field to null; a missing key is
// left untouched (PATCH semantics).
function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());
}

// Owner-only office edit (Settings → משרד). `org_code` is intentionally NOT
// editable here — it's the office's invite/join identifier. The service also
// re-checks owner (trust boundary) and the DB RLS "owner can update own org"
// enforces it a third time.
export const updateOrganizationSchema = z
  .object({
    name: orgNameField.optional(),
    email: optionalNullable(emailField),
    phone: optionalNullable(phoneField),
    address: optionalNullable(addressField),
    // DEV-013: office-wide 2FA requirement (soft enforcement — members
    // without 2FA get a persistent setup prompt).
    requireMfa: z.boolean().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field is required for update",
  });

export type UpdateOrganizationPayload = z.infer<typeof updateOrganizationSchema>;
