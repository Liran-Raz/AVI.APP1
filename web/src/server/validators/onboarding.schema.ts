import { z } from "zod";

// Single source of truth for the org-code shape.
// Mirrored in the DB CHECK constraint on `organizations.org_code` and in
// the `public.bootstrap_org` RPC. Any change here must be made there too.
export const ORG_CODE_RE = /^[A-Z0-9-]{3,20}$/;

export const orgCodeField = z
  .string()
  .trim()
  .min(3, "Org code must be at least 3 characters")
  .max(20, "Org code must be at most 20 characters")
  .transform((v) => v.toUpperCase())
  .refine((v) => ORG_CODE_RE.test(v), {
    message: "Org code must contain only uppercase letters, digits, or hyphens",
  });

export const orgNameField = z
  .string()
  .trim()
  .min(1, "Organization name is required")
  .max(120, "Organization name is too long");

export const fullNameField = z
  .string()
  .trim()
  .min(1, "Full name is required")
  .max(120, "Full name is too long");

export const bootstrapOrgSchema = z.object({
  orgName: orgNameField,
  orgCode: orgCodeField,
  fullName: fullNameField,
});

export type BootstrapOrgPayload = z.infer<typeof bootstrapOrgSchema>;
