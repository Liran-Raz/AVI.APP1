import { z } from "zod";

import { fullNameField } from "./onboarding.schema";

// Phone — same lenient shape as clients. The provider/DB is not strict on
// format; we only cap length and trim.
const phoneField = z.string().trim().max(50, "Phone is too long");

// Optional + nullable wrapper. Treats "" as null so a user can CLEAR a field
// by submitting an empty input. A MISSING key stays missing — important for
// PATCH semantics: only update fields the client explicitly sent.
function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());
}

// Self-update of the caller's OWN profile (Settings → פרופיל). Deliberately
// only the fields a user may change about themselves. role / org_id /
// is_active / email are NEVER accepted here — the service whitelists too, and
// membership/identity fields are controlled by the Team screen and auth.
export const updateProfileSchema = z
  .object({
    fullName: fullNameField.optional(),
    phone: optionalNullable(phoneField),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one field is required for update",
  });

export type UpdateProfilePayload = z.infer<typeof updateProfileSchema>;

// Per-user notification preferences (Settings → התראות). Partial PATCH — the
// service merges over the stored value; at least one key must be present.
// Extend this object as more toggles are added (the DB column is jsonb).
export const updateNotificationPrefsSchema = z
  .object({
    emailOnTaskAssignment: z.boolean().optional(),
    bellOnTaskAssignment: z.boolean().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one preference is required",
  });

export type UpdateNotificationPrefsPayload = z.infer<
  typeof updateNotificationPrefsSchema
>;
